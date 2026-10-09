(() => {
  const translations = 'immersive-translate-target-wrapper, immersive-translate-target-inner, .immersive-translate-target-wrapper, .immersive-translate-target-inner, .immersive-translate-target-translation, [data-immersive-translate-translation-element]';
  const excluded = 'script, style, annotation, pre, code, .ltx_bibliography, .ltx_listing, .ltx_verbatim, .ltx_ERROR';
  const state = { running: false, visible: true, status: '准备就绪', completed: 0, total: 0, records: [], generation: 0 };
  let painted = [], refreshTimer;

  const host = document.createElement('div');
  host.id = 'paper-highlighter-ui'; host.setAttribute('translate', 'no'); host.className = 'notranslate';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483646;font:13px/1.6 system-ui,sans-serif;color:#263347}
    section{box-sizing:border-box;width:310px;background:#fff;border:1px solid #dbe2ed;border-radius:12px;box-shadow:0 8px 30px #172d491f;padding:14px}
    strong{font-size:14px}p{margin:8px 0;overflow-wrap:anywhere}small{color:#637185}button{font:inherit;cursor:pointer;border:1px solid #ccd6e4;background:#f5f8fc;color:#24364e;padding:4px 9px;border-radius:6px;margin:3px 5px 0 0}button:hover{background:#eaf0f7}
    [data-detail]{border-top:1px solid #e4e9f0;margin-top:10px;padding-top:8px;max-height:240px;overflow:auto;white-space:pre-wrap} [hidden]{display:none}
    @media(max-width:600px){:host{right:10px;bottom:10px}section{width:270px}}
  </style><section aria-label="论文重点标记"><strong>论文重点</strong><p data-status aria-live="polite">准备就绪</p>
    <small>黄色：重点 · 紫色：假设与限制<br>点击高亮查看理由；自动判断需核对。</small><div>
    <button data-action="start">分析重点</button><button data-action="stop" hidden>停止</button><button data-action="toggle">隐藏标记</button><button data-action="clear">清除</button>
    <button data-action="minimize" aria-label="收起面板">收起</button></div><p data-detail hidden></p></section><button data-action="expand" hidden>论文重点</button>`;
  document.documentElement.append(host);

  function update() {
    shadow.querySelector('[data-status]').textContent = state.status;
    shadow.querySelector('[data-action=start]').disabled = state.running;
    shadow.querySelector('[data-action=stop]').hidden = !state.running;
    shadow.querySelector('[data-action=toggle]').textContent = state.visible ? '隐藏标记' : '显示标记';
  }

  function collectText(element, translation = false) {
    const nodes = [], parts = [], formulas = new Map();
    let size = 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest(excluded) || (!translation && parent.closest(translations))) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[hidden], [aria-hidden=true]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const math = node.parentElement.closest('math');
      if (math) {
        if (!formulas.has(math)) formulas.set(math, { start: size, end: size, notation: math.getAttribute('alttext') || math.outerHTML });
        formulas.get(math).end = size + node.data.length;
      }
      nodes.push({ node, start: size, end: size + node.data.length }); parts.push(node.data); size += node.data.length;
    }
    return { text: parts.join(''), nodes, formulas: [...formulas.values()] };
  }

  function readPaper() {
    const blocks = [], seen = new Set();
    const article = document.querySelector('article.ltx_document, .ltx_document, article');
    if (!article) throw new Error('未找到 arXiv 论文正文，请在 HTML 论文页面使用。');
    for (const element of article.querySelectorAll('p.ltx_p, .ltx_caption')) {
      if (element.closest(excluded) || element.closest(translations) || seen.has(element)) continue;
      if (element.matches('.ltx_caption') && element.querySelector('p.ltx_p')) continue;
      seen.add(element);
      const sectionElement = element.closest('.ltx_subsection, .ltx_section, .ltx_appendix, .ltx_abstract');
      const section = sectionElement?.querySelector('.ltx_title')?.textContent.trim() || (sectionElement?.matches('.ltx_abstract') ? 'Abstract' : '正文');
      const data = collectText(element);
      if (data.text.trim()) blocks.push({ element, section, language: 'en', ...data });
      for (const target of element.querySelectorAll(translations)) {
        if (target.parentElement?.closest(translations)) continue;
        const translated = collectText(target, true);
        if (/[\u3400-\u9fff]/.test(translated.text)) blocks.push({ element: target, section, language: 'zh', ...translated });
      }
    }
    const outline = [...article.querySelectorAll('.ltx_title_section, .ltx_title_subsection, section > h2, section > h3')].map(e => e.textContent.trim()).slice(0, 60);
    const overview = blocks.filter(b => b.language === 'en').slice(0, 14).map(b => b.text).join('\n').slice(0, 8000);
    const context = { title: article.querySelector('.ltx_title_document, h1')?.textContent.trim() || document.title, outline, overview };
    const sentences = blocks.flatMap(block => PaperCore.splitSentences(block.text, block.language).map(sentence => ({ ...sentence, section: block.section, language: block.language, block,
      formulas: block.formulas.filter(f => f.start < sentence.end && f.end > sentence.start).map(f => f.notation) })));
    sentences.forEach((sentence, i) => { sentence.id = `s${i}`; });
    return { context, sentences, blocks };
  }

  function textRange(block, start, end) {
    const first = block.nodes.find(n => n.end > start);
    const last = block.nodes.find(n => n.end >= end);
    if (!first || !last || !first.node.isConnected || !last.node.isConnected) return null;
    const range = document.createRange();
    range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
    return range;
  }

  function paint() {
    if (!CSS.highlights || typeof Highlight === 'undefined') return;
    const core = new Highlight(), boundary = new Highlight(); painted = [];
    for (const record of state.records) {
      if (record.priority !== 'core' || !record.block.element.isConnected) continue;
      const block = collectText(record.block.element, record.language === 'zh');
      // Original offsets remain exact when only wrappers change, even for repeats.
      let start = record.start;
      if (block.text !== record.block.text) {
        start = block.text.indexOf(record.text);
        if (start < 0 || block.text.indexOf(record.text, start + 1) >= 0) continue;
      }
      const range = textRange(block, start, start + record.text.length);
      if (!range) continue;
      (record.role === 'limitation' ? boundary : core).add(range);
      painted.push({ range, record });
    }
    if (state.visible) { CSS.highlights.set('paper-core', core); CSS.highlights.set('paper-boundary', boundary); }
    else { CSS.highlights.delete('paper-core'); CSS.highlights.delete('paper-boundary'); }
  }

  async function start() {
    if (state.running) return;
    if (!CSS.highlights || typeof Highlight === 'undefined') { state.status = '浏览器不支持文本高亮 API，请更新 Chrome / Edge。'; update(); return; }
    const generation = ++state.generation;
    state.running = true; state.records = []; state.visible = true; state.completed = 0;
    shadow.querySelector('[data-detail]').hidden = true;
    paint();
    try {
      const { context, sentences } = readPaper();
      if (!sentences.length) throw new Error('未找到可分析的正文句子。');
      const batches = PaperCore.batchSentences(sentences);
      state.total = sentences.length;
      for (const batch of batches) {
        if (generation !== state.generation) return;
        state.status = `正在分析 ${state.completed} / ${state.total} 句…`; update();
        const first = sentences.indexOf(batch[0]), last = sentences.indexOf(batch.at(-1));
        const neighbors = [...sentences.slice(Math.max(0, first - 2), first), ...sentences.slice(last + 1, last + 3)].map(s => s.text.slice(0, 1000));
        const response = await chrome.runtime.sendMessage({ type: 'classify', context, neighbors, sentences: batch.map(({ id, text, section, language, formulas }) => ({ id, text, section, language, formulas })) });
        if (generation !== state.generation) return;
        if (!response?.ok) throw new Error(response?.error || '扩展后台没有响应，请刷新页面后重试。');
        const byId = new Map(batch.map(s => [s.id, s]));
        for (const row of response.annotations) state.records.push({ ...byId.get(row.id), ...row });
        state.completed += batch.length; paint();
      }
      const selected = state.records.filter(r => r.priority === 'core').length;
      state.status = `完成：分析 ${state.total} 句，显示 ${painted.length} 句重点。${painted.length < selected ? ` 另有 ${selected - painted.length} 句因页面变化未定位，请重新分析。` : ''}`;
    } catch (error) {
      if (generation === state.generation) state.status = `${error.message}${state.completed ? ` 已保留 ${state.completed} 句的分析结果。` : ''}`;
    } finally { if (generation === state.generation) { state.running = false; update(); } }
  }

  function stop() {
    if (!state.running) return;
    state.generation++; state.running = false; state.status = `已停止，保留 ${state.completed} 句的分析结果。`; update();
    chrome.runtime.sendMessage({ type: 'abort' }).catch(() => {});
  }

  function action(type) {
    if (type === 'start') start();
    else if (type === 'stop') stop();
    else if (type === 'toggle') { state.visible = !state.visible; paint(); update(); }
    else if (type === 'clear') { stop(); state.records = []; state.completed = 0; state.status = '已清除标记'; paint(); shadow.querySelector('[data-detail]').hidden = true; update(); }
    else if (type === 'minimize' || type === 'expand') { shadow.querySelector('section').hidden = type === 'minimize'; shadow.querySelector('[data-action=expand]').hidden = type === 'expand'; }
  }

  shadow.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button) action(button.dataset.action); });
  document.addEventListener('click', event => {
    if (!state.visible || event.composedPath().includes(host)) return;
    for (const { range, record } of painted) {
      if ([...range.getClientRects()].some(r => event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom)) {
        const detail = shadow.querySelector('[data-detail]');
        detail.textContent = `${PaperCore.roles[record.role]} · 重点\n${record.reason}\n\n${record.text}`; detail.hidden = false;
        shadow.querySelector('section').hidden = false; shadow.querySelector('[data-action=expand]').hidden = true;
        break;
      }
    }
  });
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (['start', 'stop', 'toggle', 'clear'].includes(message.type)) action(message.type);
    if (['status', 'start', 'stop', 'toggle', 'clear'].includes(message.type)) reply({ running: state.running, visible: state.visible, status: state.status });
  });
  const observer = new MutationObserver(mutations => {
    if (!state.records.length || mutations.every(m => host.contains(m.target))) return;
    clearTimeout(refreshTimer); refreshTimer = setTimeout(paint, 250);
  });
  observer.observe(document.querySelector('.ltx_document') || document.body, { subtree: true, childList: true, characterData: true });
})();
