const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

const fixture = `<!doctype html><html><head><style>article{width:720px;margin:40px auto}p{font:18px/1.6 Georgia}</style></head><body>
<article class="ltx_document"><h1 class="ltx_title ltx_title_document">DGM fixture</h1>
<div class="ltx_abstract"><p class="ltx_p">We test code using benchmarks.</p></div>
<section class="ltx_section" id="S1"><h2 class="ltx_title">Introduction</h2>
<p class="ltx_p" id="mixed">Scientific progress builds on past insights. We modify code and evaluate it using <a href="#ref">benchmarks</a>. However, we do not train foundation models.</p>
<p class="ltx_p" id="math">We select agents using <math alttext="x^2"><msup><mi>x</mi><mn>2</mn></msup></math> and <math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>. One can imagine endless innovation.</p>
<p class="ltx_p" id="repeat">We evaluate code. We evaluate code.</p>
</section><section class="ltx_bibliography"><p class="ltx_p" id="ref">Reference. Author 2017.</p></section></article></body></html>`;

test('loaded extension highlights exact text without modifying paper layout and supports translations, errors and cancellation', { timeout: 120000 }, async () => {
  const source = path.resolve('extension');
  assert.ok(fs.existsSync(path.join(source, 'manifest.json')), 'production extension manifest must exist');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-highlight-test-'));
  const ext = path.join(tmp, 'extension');
  fs.cpSync(source, ext, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json')));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  // The test opens popup.html directly, without the user gesture that grants activeTab.
  manifest.permissions.push('tabs');
  fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(manifest));
  let mode = 'success', calls = 0, seen = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body); calls++;
    const input = JSON.parse(request.messages[1].content);
    seen.push(...input.sentences);
    assert.equal(req.headers.authorization, 'Bearer test-only-key');
    if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 2000));
    const annotations = input.sentences.map(s => {
      const vision = /imagine|想象/.test(s.text), background = /Scientific progress|科学进步/.test(s.text), limit = /do not|不训练/.test(s.text);
      const target = (input.translations || []).find(t => t.sourceIds.includes(s.id));
      const quote = mode==='crossOverlap' && /cross-batch item (0|29|59)\./.test(s.text) ? '共同译文。' : limit ? '然而，我们不训练基础模型。' : s.text.includes('We modify') ? '我们修改代码并用基准评估。' : '';
      let matches = mode !== 'unaligned' && target && quote ? [{id:target.id,quote: mode === 'misaligned' && !limit ? '这不是页面中的译文。' : quote}] : [];
      if(mode==='ids' && target && quote) { const segment=target.segments?.find(part=>part.text===quote); matches=segment?[{id:target.id,sentenceIds:[segment.id]}]:[]; }
      return { matches, id: s.id, role: vision ? 'vision' : background ? 'background' : limit ? 'limitation' : 'mechanism', priority: vision || background ? 'background' : 'core', reason: limit ? '限制实际验证的能力范围。' : '解释改写代码与评估的机制。' };
    });
    if (mode === 'bad') annotations.pop();
    res.setHeader('Content-Type', 'text/event-stream');
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ annotations }) }, finish_reason: 'stop' }] }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run'],
      ignoreDefaultArgs: ['--disable-extensions']
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${id}/options.html`);
    await settings.evaluate(async baseUrl => {
      await chrome.storage.local.set({ settings: { baseUrl, model: 'test-model', apiKey: 'test-only-key' } });
    }, `http://127.0.0.1:${server.address().port}/v1`);
    const paper = await context.newPage();
    await paper.route('https://arxiv.org/html/**', route => route.fulfill({ body: fixture, contentType: 'text/html' }));
    await paper.goto('https://arxiv.org/html/2505.22954v3');
    await paper.waitForSelector('#paper-highlighter-ui', { state: 'attached' });
    const before = await paper.locator('article').evaluate(el => ({ html: el.innerHTML, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, font: getComputedStyle(el.querySelector('p')).fontSize }));
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    const send = type => popup.evaluate(async ({ type, paperUrl }) => {
      const tabs = await chrome.tabs.query({});
      const tab = tabs.find(t => t.url === paperUrl);
      return chrome.tabs.sendMessage(tab.id, { type });
    }, { type, paperUrl: paper.url() });
    await send('start');
    await paper.waitForFunction(() => document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent.includes('完成'));
    assert.ok(calls > 0);
    assert.ok(!seen.some(s => /Author 2017/.test(s.text)), 'references must not be sent');
    const mathematical = seen.find(s => s.text.includes('We select agents'));
    assert.ok(mathematical.formulas.includes('x^2'));
    assert.ok(mathematical.formulas.some(f => f.includes('<mfrac>')), 'formula structure must reach the model');
    const after = await paper.locator('article').evaluate(el => ({ html: el.innerHTML, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, font: getComputedStyle(el.querySelector('p')).fontSize }));
    assert.deepEqual(after, before, 'highlighting must not mutate article or layout');
    assert.ok(await paper.evaluate(() => CSS.highlights.get('paper-core').size >= 2));
    assert.equal(await paper.evaluate(() => CSS.highlights.get('paper-boundary').size), 1);
    assert.equal(await paper.evaluate(() => [...CSS.highlights.get('paper-core')].filter(r => r.toString() === 'We evaluate code.').length), 2, 'repeated sentences should both retain exact offsets');
    // Select the actual highlighted Range rather than guessing which line contains it.
    const rect = await paper.evaluate(() => { const r = [...CSS.highlights.get('paper-core')].find(r => r.toString().includes('We modify')); const b = r.getClientRects()[0]; return { x: b.x + 5, y: b.y + b.height / 2 }; });
    await paper.mouse.click(rect.x, rect.y);
    assert.ok(await paper.locator('#paper-highlighter-ui').locator('[data-detail]').innerText().then(t => t.includes('机制')));
    await send('toggle');
    assert.equal(await paper.evaluate(() => CSS.highlights.has('paper-core')), false);
    await send('toggle');
    // Simulate translation wrapping and inserting nodes after the initial analysis.
    await paper.evaluate(() => {
      const p = document.querySelector('#mixed');
      const wrapper = document.createElement('span'); wrapper.className = 'immersive-translate-original-wrapper';
      while (p.firstChild) wrapper.append(p.firstChild); p.append(wrapper);
      const translated = document.createElement('font'); translated.className = 'immersive-translate-target-inner';
      translated.textContent = '科学进步建立在已有发现上。我们修改代码并用基准评估。然而，我们不训练基础模型。';
      const targetWrapper=document.createElement('font'); targetWrapper.className='immersive-translate-target-wrapper'; targetWrapper.setAttribute('data-immersive-translate-translation-element-mark','1');
      targetWrapper.append(translated); p.append(targetWrapper);
    });
    await paper.waitForFunction(() => [...CSS.highlights.get('paper-core')].some(r => r.toString().includes('We modify')));
    seen = []; await send('start');
    await paper.waitForFunction(() => document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent.includes('完成'));
    assert.ok(!seen.some(s => s.language === 'zh'), 'Chinese must inherit English decisions rather than be independently classified');
    assert.ok(await paper.evaluate(() => [...CSS.highlights.get('paper-core')].some(r => r.toString().includes('修改代码'))));
    assert.ok(await paper.evaluate(() => ![...CSS.highlights.get('paper-core')].some(r => /Scientific progress|科学进步|imagine/.test(r.toString()))));
    assert.equal(await paper.evaluate(() => [...CSS.highlights.get('paper-boundary')].filter(r => /do not|不训练/.test(r.toString())).length), 2);
    const translatedRect = await paper.evaluate(() => { const r = [...CSS.highlights.get('paper-core')].find(r=>r.toString().includes('修改代码')); const b=r.getClientRects()[0]; return {x:b.x+5,y:b.y+b.height/2}; });
    await paper.mouse.click(translatedRect.x,translatedRect.y);
    assert.match(await paper.locator('#paper-highlighter-ui').locator('[data-detail]').innerText(), /解释改写代码与评估的机制/);
    // Some vendor styles render a separate block directly after the source.
    await paper.evaluate(() => {const p=document.querySelector('#mixed');p.after(p.querySelector('.immersive-translate-target-wrapper'));});
    const translatedHTML=await paper.locator('article').innerHTML();
    await send('start');
    await paper.waitForFunction(() => document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent.includes('完成'));
    assert.equal(await paper.locator('article').innerHTML(),translatedHTML);
    assert.equal(await paper.evaluate(() => [...CSS.highlights.get('paper-boundary')].filter(r=>r.toString().includes('不训练')).length),1);
    mode='ids';await send('start');
    await paper.waitForFunction(() => document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent.includes('完成'));
    assert.equal(await paper.evaluate(()=>[...CSS.highlights.get('paper-boundary')].filter(r=>r.toString().includes('不训练')).length),1,'Chinese IDs must produce a real range');
    assert.match(await paper.locator('#paper-highlighter-ui').locator('[data-status]').innerText(),/英文.*中文/);
    await paper.evaluate(()=>{const p=document.querySelector('#mixed');p.before(p.nextElementSibling);});
    await send('start');
    await paper.waitForFunction(() => document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent.includes('完成'));
    assert.equal(await paper.evaluate(()=>[...CSS.highlights.get('paper-boundary')].filter(r=>r.toString().includes('不训练')).length),1,'translation inserted BEFORE source must still pair');
    await paper.evaluate(()=>{const target=document.querySelector('.immersive-translate-target-wrapper');target.replaceWith(target.cloneNode(true));});
    await paper.waitForTimeout(400);
    assert.equal(await paper.evaluate(()=>[...CSS.highlights.get('paper-boundary')].filter(r=>r.toString().includes('不训练')).length),1,'vendor replacing its translation nodes must not erase Chinese highlights');
    const chineseStyle=await paper.locator('.immersive-translate-target-inner').evaluate(el=>getComputedStyle(el,'::highlight(paper-core)').backgroundColor);
    assert.notEqual(chineseStyle,'rgba(0, 0, 0, 0)','Chinese highlighting must have a visible background style');
    await paper.screenshot({path:path.resolve('docs/superpowers/plans/bilingual-preview.png')});
    await paper.evaluate(()=>{const p=document.querySelector('#mixed');const target=p.previousElementSibling;const br=document.createElement('br');br.setAttribute('data-imt','1');p.after(br);br.after(target);});
    await send('start');
    await paper.waitForFunction(() => document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent.includes('完成'));
    await paper.evaluate(()=>{const target=document.querySelector('.immersive-translate-target-wrapper');target.replaceWith(target.cloneNode(true));});
    await paper.waitForTimeout(400);
    assert.equal(await paper.evaluate(()=>[...CSS.highlights.get('paper-boundary')].filter(r=>r.toString().includes('不训练')).length),1,'vendor br separators must not break reconnection');
    mode='unaligned';await send('start');
    await paper.waitForFunction(() => document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent.includes('未可靠对应'));
    assert.ok(await paper.evaluate(()=>[...CSS.highlights.get('paper-core')].some(r=>r.toString().includes('We modify'))));
    assert.ok(await paper.evaluate(()=>![...CSS.highlights.get('paper-core')].some(r=>r.toString().includes('修改代码'))));
    await paper.evaluate(()=>{for(let i=0;i<40;i++){const p=document.createElement('p');p.className='ltx_p';p.textContent=`We evaluate implementation number ${i}.`;document.querySelector('#S1').append(p);}});
    mode='misaligned';seen=[];const beforeFailureCalls=calls;await send('start');
    await paper.waitForFunction(() => document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent.includes('完成'));
    assert.ok(calls>beforeFailureCalls+1,'analysis must continue through later batches');
    assert.ok(seen.some(s=>s.text.includes('number 39')),'last paragraph must still be analyzed');
    assert.ok(await paper.evaluate(()=>[...CSS.highlights.get('paper-core')].some(r=>r.toString().includes('number 39'))));
    assert.ok(await paper.evaluate(()=>[...CSS.highlights.get('paper-boundary')].some(r=>r.toString().includes('不训练'))),'valid Chinese match survives another invalid match');
    await paper.evaluate(()=>{const p=document.createElement('p');p.className='ltx_p';p.textContent=Array.from({length:60},(_,i)=>`We evaluate cross-batch item ${i}.`).join(' ');const target=document.createElement('font');target.className='immersive-translate-target-inner';target.textContent='共同译文。';p.append(target);document.querySelector('#S1').append(p);});
    mode='crossOverlap';await send('start');
    await paper.waitForFunction(() => document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent.includes('完成'));
    assert.equal(await paper.evaluate(()=>[...CSS.highlights.get('paper-core')].filter(r=>r.toString()==='共同译文。').length),0,'conflicting spans across batches must both be removed');
    assert.ok(await paper.evaluate(()=>[...CSS.highlights.get('paper-core')].some(r=>r.toString().includes('cross-batch item 29'))));
    mode = 'bad'; await send('start');
    await paper.waitForFunction(() => document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent.includes('遗漏'));
    assert.equal(await paper.evaluate(() => CSS.highlights.get('paper-core').size), 0);
    mode = 'slow'; const prior = calls; await send('start');
    await paper.waitForFunction(() => document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent.includes('分析'));
    await send('stop');
    await paper.waitForFunction(() => document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent.includes('停止'));
    await new Promise(resolve => setTimeout(resolve, 2200));
    assert.equal(await paper.evaluate(() => CSS.highlights.get('paper-core').size), 0, 'late response after cancellation must not paint');
    assert.ok(calls <= prior + 1);
    await send('clear');
    assert.equal(await paper.evaluate(() => CSS.highlights.get('paper-core').size), 0);
    await worker.evaluate(()=>chrome.runtime.reload()).catch(()=>{});
    await paper.waitForTimeout(700);
    await paper.locator('#paper-highlighter-ui').locator('[data-action=start]').click();
    await paper.waitForFunction(()=>document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent.includes('扩展已更新或重新加载'));
    assert.equal(await paper.locator('#paper-highlighter-ui').locator('[data-action=start]').isDisabled(),true);
    assert.match(await paper.locator('#paper-highlighter-ui').locator('[data-status]').innerText(),/刷新论文网页.*重新翻译/);
    mode='success';await paper.reload();await paper.waitForSelector('#paper-highlighter-ui',{state:'attached'});
    await paper.locator('#paper-highlighter-ui').locator('[data-action=start]').click();
    await paper.waitForFunction(()=>document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent.includes('完成'));
    assert.ok(await paper.evaluate(()=>CSS.highlights.get('paper-core').size>0),'refresh reconnects extension and retains API settings');
    console.log('Browser integration: source + translation + unchanged layout + rationale + malformed results + cancellation verified.');
  } finally {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
    // Only delete the exact directory created by mkdtemp, beneath the OS temp directory.
    if (tmp.startsWith(path.join(os.tmpdir(), 'paper-highlight-test-'))) fs.rmSync(tmp, { recursive: true, force: true });
  }
});
