// Transport/DOM smoke test on the actual paper. The local API returns test labels,
// not genuine model judgments, so this does NOT measure semantic accuracy.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-real-smoke-'));
  const extension = path.join(tmp, 'extension');
  fs.cpSync(path.resolve('extension'), extension, { recursive: true });
  const manifestPath = path.join(extension, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  manifest.permissions.push('tabs'); manifest.host_permissions = ['http://127.0.0.1/*'];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  let calls = 0, sentences = 0;
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(JSON.parse(body).messages[1].content);
    calls++; sentences += payload.sentences.length;
    const content = JSON.stringify({ annotations: payload.sentences.map(s => ({ id: s.id, role: 'mechanism', priority: 'core', reason: '仅为页面定位测试标签，不代表模型判断。' })) });
    res.setHeader('Content-Type', 'text/event-stream');
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { content }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      executablePath: process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`], ignoreDefaultArgs: ['--disable-extensions']
    });
    const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    const settings = await browser.newPage(); await settings.goto(`chrome-extension://${id}/options.html`);
    await settings.locator('#baseUrl').fill(`http://127.0.0.1:${server.address().port}/v1`);
    await settings.locator('#model').fill('test-model'); await settings.locator('#apiKey').fill('test-only-key');
    await settings.getByRole('button', { name: '保存设置' }).click();
    await settings.waitForFunction(() => document.querySelector('#status').textContent.includes('已保存'));
    await settings.getByRole('button', { name: '测试连接' }).click();
    await settings.waitForFunction(() => document.querySelector('#status').textContent.includes('连接成功'));
    const paper = await browser.newPage();
    await paper.goto('https://arxiv.org/html/2505.22954v3#S1', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await paper.waitForSelector('#paper-highlighter-ui', { state: 'attached' });
    await paper.evaluate(() => document.fonts.ready);
    const before = await paper.locator('article.ltx_document').evaluate(el => ({ html: el.innerHTML, paragraphs: el.querySelectorAll('p.ltx_p').length, math: el.querySelectorAll('math').length, links: el.querySelectorAll('a').length, font: getComputedStyle(el.querySelector('p.ltx_p')).fontSize }));
    const control = await browser.newPage(); await control.goto(`chrome-extension://${id}/popup.html`);
    await control.evaluate(async url => { const tabs = await chrome.tabs.query({}); await chrome.tabs.sendMessage(tabs.find(t => t.url === url).id, { type: 'start' }); }, paper.url());
    await paper.waitForFunction(() => {
      const text = document.querySelector('#paper-highlighter-ui').shadowRoot.querySelector('[data-status]').textContent;
      return text.includes('完成') || !text.includes('分析');
    }, null, { timeout: 60000 });
    const status = await paper.locator('#paper-highlighter-ui').locator('[data-status]').innerText();
    assert.match(status, /完成/);
    const after = await paper.locator('article.ltx_document').evaluate(el => ({ html: el.innerHTML, paragraphs: el.querySelectorAll('p.ltx_p').length, math: el.querySelectorAll('math').length, links: el.querySelectorAll('a').length, font: getComputedStyle(el.querySelector('p.ltx_p')).fontSize }));
    assert.deepEqual(after, before);
    console.log(JSON.stringify({ status, calls, sentences, paragraphs: before.paragraphs, math: before.math, links: before.links, fontSize: before.font, highlightedRanges: await paper.evaluate(() => CSS.highlights.get('paper-core').size), note: 'Mock API validates DOM and transport only; no real DeepSeek inference.' }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
    if (tmp.startsWith(path.join(os.tmpdir(), 'paper-real-smoke-'))) fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
