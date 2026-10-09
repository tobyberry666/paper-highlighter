const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const core = require('../extension/core.js');

test('stop during settings load cancels the request; immediate restart owns its own lock', async () => {
  let listener, fetches = 0;
  const pendingSettings = [];
  const settings = { settings: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'test-only-key' } };
  const chrome = {
    storage: { local: { setAccessLevel: () => Promise.resolve(), get: () => new Promise(resolve => pendingSettings.push(resolve)) } },
    permissions: { contains: () => Promise.resolve(true) },
    runtime: { getURL: () => 'chrome-extension://test/', getPlatformInfo: () => Promise.resolve({}), onMessage: { addListener: fn => { listener = fn; } } },
    tabs: { onRemoved: { addListener() {} } }
  };
  vm.runInNewContext(fs.readFileSync('extension/background.js', 'utf8'), {
    chrome, PaperCore: core, importScripts() {}, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: async (url, request) => {
      fetches++; assert.equal(request.signal.aborted, false);
      const body = JSON.parse(request.body);
      assert.deepEqual(body.thinking, { type: 'disabled' });
      assert.equal(body.stream, true);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ annotations: [{ id: 's0', role: 'mechanism', priority: 'core', reason: '验证机制。' }] }) }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
    }
  });
  const sender = { url: 'https://arxiv.org/html/test', tab: { id: 7 } };
  const message = { type: 'classify', context: { title: 'test' }, neighbors: [], sentences: [{ id: 's0', text: 'We evaluate agents.' }] };
  const send = message => new Promise(resolve => listener(message, sender, resolve));
  const first = send(message);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pendingSettings.length, 1);
  assert.equal((await send({ type: 'abort' })).ok, true);
  const second = send(message);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pendingSettings.length, 2);
  pendingSettings[0](settings);
  assert.equal((await first).ok, false);
  assert.equal(fetches, 0, 'a cancelled request must not send data or consume a model call');
  pendingSettings[1](settings);
  assert.equal((await second).ok, true);
  assert.equal(fetches, 1);
});
