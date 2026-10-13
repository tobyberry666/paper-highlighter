(() => {
  const translations = 'immersive-translate-target-wrapper, immersive-translate-target-inner, .immersive-translate-target-wrapper, .immersive-translate-target-inner, .immersive-translate-target-translation, [data-immersive-translate-translation-element], [data-immersive-translate-translation-element-mark]';
  const excluded = 'script, style, annotation, pre, code, .ltx_bibliography, .ltx_listing, .ltx_verbatim, .ltx_ERROR';
  const state = { running: false, expired: false, visible: true, status: '准备就绪', completed: 0, total: 0, records: [], generation: 0 };
  let painted = [], refreshTimer;

  const host = document.createElement('div');
  host.id = 'paper-highlighter-ui'; host.setAttribute('translate', 'no'); host.className = 'notranslate';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host{all:initial;position:fixed;right:20px;bottom:20px;z-index:2147483646;font:13px/1.6 system-ui,sans-serif;color:#263347}
    section{box-sizing:border-box;width:310px;background:#fff;border:1px solid #dbe2ed;border-radius:12px;box-shadow:0 8px 30px #172d491f;padding:14px}
    strong{font-size:14px}p{margin:8px 0;overflow-wrap:anywhere}small{color:#637185}button{font:inherit;cursor:pointer;border:1px solid #ccd6e4;background:#f5f8fc;color:#24364e;padding:4px 9px;border-radius:6px;margin:3px 5px 0 0}button:hover{background:#eaf0f7}
    [data-detail]{border-top:1px solid #e4e9f0;margin-top:10px;padding-top:8px;max-height:240px;overflow:auto;white-space:pre-wrap} [hidden]{display:none}
    [data-find]{position:fixed;right:20px;top:20px;background:#fff;border:1px solid #dbe2ed;border-radius:10px;box-shadow:0 8px 30px #172d491f;padding:12px;width:310px;box-sizing:border-box}
    [data-find] input{box-sizing:border-box;width:100%;font:inherit;padding:7px;border:1px solid #ccd6e4;border-radius:6px}
    @media(max-width:600px){:host{right:10px;bottom:10px}section{width:270px}}
  </style><section aria-label="论文重点标记"><strong>论文重点</strong><p data-status aria-live="polite">准备就绪</p>
    <small>黄色：重点 · 紫色：假设与限制<br>点击高亮查看理由；自动判断需核对。</small><div>
    <button data-action="start">分析重点</button><button data-action="stop" hidden>停止</button><button data-action="toggle">隐藏标记</button><button data-action="clear">清除</button>
    <button data-action="minimize" aria-label="收起面板">收起</button></div><p data-detail hidden></p></section><button data-action="expand" hidden>论文重点</button>
    <div data-find role="dialog" aria-label="论文文本搜索" hidden><input type="search" aria-label="搜索文本" placeholder="搜索英文或已有中文译文" autocomplete="off"><p data-find-count aria-live="polite">输入搜索文本</p><button data-find-action="previous" aria-label="上一处">↑</button><button data-find-action="next" aria-label="下一处">↓</button><button data-find-action="close">关闭</button><p><small>Enter 下一处 · Shift+Enter 上一处 · Esc 关闭</small></p></div>`;
  document.documentElement.append(host);

  function update() {
    shadow.querySelector('[data-status]').textContent = state.status;
    shadow.querySelector('[data-action=start]').disabled = state.running || state.expired;
    shadow.querySelector('[data-action=stop]').hidden = !state.running;
    shadow.querySelector('[data-action=toggle]').textContent = state.visible ? '隐藏标记' : '显示标记';
  }

  function expiredContext(error) {
    if (!/Extension context invalidated/i.test(error?.message || '')) return false;
    state.expired = true;
    state.status = '扩展已更新或重新加载。请刷新论文网页，再用沉浸式翻译重新翻译，然后分析重点；接口设置无需修改。';
    update(); return true;
  }

  function collectText(element, translation = false, search = false) {
    const nodes = [], parts = [], formulas = new Map();
    let size = 0;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || parent.closest(search ? 'script, style, annotation, pre, code, .ltx_ERROR' : excluded) || (!translation && (parent.closest(translations) || parent.closest('[data-imt="1"]')))) return NodeFilter.FILTER_REJECT;
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

  function translationCandidates(owner) {
    const candidates = [...owner.querySelectorAll(translations)];
    let following = owner.nextElementSibling;
    while (following?.matches('br[data-imt="1"]')) following = following.nextElementSibling;
    if (following?.matches(translations)) candidates.push(following);
    let preceding = owner.previousElementSibling;
    while (preceding?.matches('br[data-imt="1"]')) preceding = preceding.previousElementSibling;
    let previousSource = preceding?.previousElementSibling;
    while (previousSource?.matches('br[data-imt="1"]')) previousSource = previousSource.previousElementSibling;
    if (preceding?.matches(translations) && !previousSource?.matches('p.ltx_p, .ltx_caption')) candidates.push(preceding);
    return candidates.filter(element => !element.parentElement?.closest(translations));
  }

  function readPaper() {
    const blocks = [], targets = [], seen = new Set();
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
      const source = blocks.at(-1);
      if (!source || source.element !== element) continue;
      const candidates = translationCandidates(element);
      for (const target of candidates) {
        if (target.parentElement?.closest(translations) || targets.some(t => t.element === target)) continue;
        const translated = collectText(target, true);
        if (/[\u3400-\u9fff]/.test(translated.text)) targets.push({ id: `t${targets.length}`, element: target, source, section, language: 'zh', ...translated });
      }
    }
    const outline = [...article.querySelectorAll('.ltx_title_section, .ltx_title_subsection, section > h2, section > h3')].map(e => e.textContent.trim()).slice(0, 60);
    const overview = blocks.filter(b => b.language === 'en').slice(0, 14).map(b => b.text).join('\n').slice(0, 8000);
    const context = { title: article.querySelector('.ltx_title_document, h1')?.textContent.trim() || document.title, outline, overview };
    const sentences = blocks.flatMap(block => PaperCore.splitSentences(block.text, block.language).map(sentence => ({ ...sentence, section: block.section, language: block.language, block,
      formulas: block.formulas.filter(f => f.start < sentence.end && f.end > sentence.start).map(f => f.notation) })));
    sentences.forEach((sentence, i) => { sentence.id = `s${i}`; });
    for (const target of targets) target.sourceIds = sentences.filter(s => s.block === target.source).map(s => s.id);
    return { context, sentences, targets };
  }

  function textRange(block, start, end) {
    const first = block.nodes.find(n => n.end > start);
    const last = block.nodes.find(n => n.end >= end);
    if (!first || !last || !first.node.isConnected || !last.node.isConnected) return null;
    const range = document.createRange();
    range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start);
    return range;
  }

  const finder = shadow.querySelector('[data-find]');
  const query = finder.querySelector('input');
  let searchRanges = [], searchIndex = -1, previousFocus;

  function showSearchMatch(step = 0, scroll = true) {
    if (searchRanges.length) searchIndex = (searchIndex + step + searchRanges.length) % searchRanges.length;
    finder.querySelector('[data-find-count]').textContent = !query.value.trim() ? '输入搜索文本' : searchRanges.length ? `${searchIndex + 1} / ${searchRanges.length}` : '未找到匹配文本';
    for (const button of finder.querySelectorAll('[data-find-action=previous], [data-find-action=next]')) button.disabled = !searchRanges.length;
    if (!CSS.highlights || typeof Highlight === 'undefined') return;
    CSS.highlights.set('paper-find', new Highlight(...searchRanges));
    const active = searchRanges[searchIndex];
    CSS.highlights.set('paper-find-current', new Highlight(...(active ? [active] : [])));
    if (scroll && active) {
      const rect = active.getBoundingClientRect();
      window.scrollBy({ top: rect.top - window.innerHeight / 2, left: rect.left < 0 ? rect.left : rect.right > window.innerWidth ? rect.right - window.innerWidth : 0, behavior: 'instant' });
    }
  }

  function searchText(scroll = true) {
    searchRanges = []; searchIndex = 0;
    const article = document.querySelector('article.ltx_document, .ltx_document, article');
    const value = query.value.trim();
    if (article && value) {
      const pattern = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
      const selector = 'p, .ltx_caption, .ltx_title, td, th, li';
      const sources = [...article.querySelectorAll(selector)].filter(element => !element.closest(translations) && ![...element.querySelectorAll(selector)].some(child => !child.closest(translations)));
      const targets = [...article.querySelectorAll(translations)].filter(element => !element.parentElement?.closest(translations));
      for (const element of [...sources, ...targets]) {
        const block = collectText(element, element.matches(translations), true);
        for (const match of block.text.matchAll(pattern)) {
          const range = textRange(block, match.index, match.index + match[0].length);
          if (range?.getClientRects().length) searchRanges.push(range);
        }
      }
      searchRanges.sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b));
    }
    showSearchMatch(0, scroll);
  }

  function closeSearch() {
    finder.hidden = true; searchRanges = []; searchIndex = -1;
    CSS.highlights?.delete('paper-find'); CSS.highlights?.delete('paper-find-current');
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  query.addEventListener('input', () => searchText());
  finder.addEventListener('click', event => {
    const type = event.target.closest('[data-find-action]')?.dataset.findAction;
    if (type === 'close') closeSearch();
    if (type === 'next' || type === 'previous') showSearchMatch(type === 'next' ? 1 : -1);
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopPropagation();
      if (finder.hidden) previousFocus = document.activeElement;
      finder.hidden = false; query.focus(); query.select(); searchText(false);
    } else if (!finder.hidden && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeSearch();
    } else if (!finder.hidden && event.composedPath().includes(finder) && event.key === 'Enter' && !event.isComposing) {
      event.preventDefault(); showSearchMatch(event.shiftKey ? -1 : 1);
    }
  }, true);

  function paint() {
    if (!CSS.highlights || typeof Highlight === 'undefined') return;
    const core = new Highlight(), boundary = new Highlight(); painted = [];
    for (const record of state.records) {
      if (record.priority !== 'core') continue;
      if (!record.block.element.isConnected && record.language === 'zh' && record.block.source.element.isConnected) {
        const owner = record.block.source.element;
        const replacements = translationCandidates(owner).filter(element =>
          !state.records.some(other => other.language === 'zh' && other.block.source !== record.block.source && other.block.element === element) &&
          collectText(element, true).text === record.block.text);
        if (replacements.length === 1) record.block.element = replacements[0];
      }
      if (!record.block.element.isConnected) continue;
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
    if (state.running || state.expired) return;
    if (!CSS.highlights || typeof Highlight === 'undefined') { state.status = '浏览器不支持文本高亮 API，请更新 Chrome / Edge。'; update(); return; }
    const generation = ++state.generation;
    state.running = true; state.records = []; state.visible = true; state.completed = 0;
    shadow.querySelector('[data-detail]').hidden = true;
    paint();
    try {
      const { context, sentences, targets } = readPaper();
      if (!sentences.length) throw new Error('未找到可分析的正文句子。');
      const batches = PaperCore.batchSentences(sentences, sentence => sentence.text.length + targets.filter(t => t.sourceIds.includes(sentence.id)).reduce((size, t) => size + 2 * t.text.length, 0));
      const unmatched = new Set();
      const alignmentHistory = [];
      state.total = sentences.length;
      for (const batch of batches) {
        if (generation !== state.generation) return;
        state.status = `正在分析 ${state.completed} / ${state.total} 句…`; update();
        const first = sentences.indexOf(batch[0]), last = sentences.indexOf(batch.at(-1));
        const neighbors = [...sentences.slice(Math.max(0, first - 2), first), ...sentences.slice(last + 1, last + 3)].map(s => s.text.slice(0, 1000));
        const batchIds = new Set(batch.map(s => s.id));
        const batchTargets = targets.filter(t => t.sourceIds.some(id => batchIds.has(id))).map(({id,text,sourceIds}) => ({id,text,sourceIds:sourceIds.filter(id=>batchIds.has(id))}));
        const response = await chrome.runtime.sendMessage({ type: 'classify', context, neighbors, translations: batchTargets, sentences: batch.map(({ id, text, section, language, formulas }) => ({ id, text, section, language, formulas })) });
        if (generation !== state.generation) return;
        if (!response?.ok) throw new Error(response?.error || '扩展后台没有响应，请刷新页面后重试。');
        const incoming = response.annotations.flatMap(row => row.alignmentSpans || row.matches || []);
        const overlaps = (record, match) => record.block.id === match.id && record.start < match.end && record.end > match.start;
        state.records = state.records.filter(record => {
          if (record.language !== 'zh' || !incoming.some(match => overlaps(record, match))) return true;
          unmatched.add(record.id); return false;
        });
        for (const row of response.annotations) row.matches = (row.matches || []).filter(match => {
          if (!alignmentHistory.some(record => overlaps(record, match))) return true;
          unmatched.add(row.id); return false;
        });
        for (const match of incoming) alignmentHistory.push({ block: { id: match.id }, start: match.start, end: match.end });
        const byId = new Map(batch.map(s => [s.id, s]));
        for (const row of response.annotations) {
          const source = byId.get(row.id);
          state.records.push({ ...source, ...row });
          if (row.priority !== 'core') continue;
          if (batchTargets.some(t => t.sourceIds.includes(row.id)) && (!row.matches?.length || row.alignmentIssues)) unmatched.add(row.id);
          for (const match of row.matches || []) {
            const target = targets.find(t => t.id === match.id);
            state.records.push({ ...row, text: match.quote, start: match.start, end: match.end, block: target, language: 'zh' });
          }
        }
        state.completed += batch.length; paint();
      }
      const selected = state.records.filter(r => r.priority === 'core').length;
      const english = painted.filter(item => item.record.language === 'en').length;
      const chinese = painted.filter(item => item.record.language === 'zh').length;
      state.status = `完成：分析 ${state.total} 句，英文重点 ${english} 处，中文重点 ${chinese} 处；识别 ${targets.length} 个中文译文块。${unmatched.size ? ` ${unmatched.size} 句重点的部分或全部译文未可靠对应，已保留英文重点。` : ''}${!targets.length ? ' 未检测到中文译文，请先使用沉浸式翻译。' : ''}${targets.length && !chinese ? ' 中文尚未成功标注，请核对译文对应结果。' : ''}${painted.length < selected ? ` 另有 ${selected - painted.length} 处因页面变化未定位，请重新分析。` : ''}`;
    } catch (error) {
      if (generation === state.generation && !expiredContext(error)) state.status = `${error.message}${state.completed ? ` 已保留 ${state.completed} 句的分析结果。` : ''}`;
    } finally { if (generation === state.generation) { state.running = false; update(); } }
  }

  function stop() {
    if (!state.running) return;
    state.generation++; state.running = false; state.status = `已停止，保留 ${state.completed} 句的分析结果。`; update();
    try { chrome.runtime.sendMessage({ type: 'abort' }).catch(expiredContext); }
    catch (error) { expiredContext(error); }
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
    if ((!state.records.length && finder.hidden) || mutations.every(m => host.contains(m.target))) return;
    clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { paint(); if (!finder.hidden) searchText(false); }, 250);
  });
  observer.observe(document.querySelector('.ltx_document') || document.body, { subtree: true, childList: true, characterData: true });
})();
