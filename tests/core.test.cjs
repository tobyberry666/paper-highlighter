const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../extension/core.js');

test('scientific references, abbreviations and decimals keep original offsets', () => {
  const text = 'See Fig. 1 and transformers (Vaswani et al., 2017). Accuracy is 50.0%. We test agents.';
  const sentences = core.splitSentences(text, 'en');
  assert.equal(sentences.length, 3);
  assert.equal(sentences[0].text, 'See Fig. 1 and transformers (Vaswani et al., 2017).');
  for (const sentence of sentences) assert.equal(text.slice(sentence.start, sentence.end), sentence.text);
});

test('Chinese sentences preserve punctuation and spaces', () => {
  assert.deepEqual(core.splitSentences('  方法改写代码。实验验证效果！ 尚未训练模型。', 'zh').map(s => s.text),
    ['方法改写代码。', '实验验证效果！', '尚未训练模型。']);
});

const sentences = [{ id: 's1', text: 'We test code.' }, { id: 's2', text: 'We hope for endless progress.' }];
const rows = [
  { id: 's1', role: 'mechanism', priority: 'core', reason: '解释如何验证代码。' },
  { id: 's2', role: 'vision', priority: 'core', reason: '表达愿景。' }
];

test('background and vision cannot be painted as core mechanisms', () => {
  const result = core.parseAnnotations(JSON.stringify({ annotations: rows }), sentences);
  assert.equal(result[0].priority, 'core');
  assert.equal(result[1].priority, 'background');
});

test('reject unknown, duplicated and missing IDs instead of painting the wrong sentence', () => {
  for (const annotations of [[rows[0]], [rows[0], rows[0]], [rows[0], { ...rows[1], id: 'unknown' }]]) {
    assert.throws(() => core.parseAnnotations(JSON.stringify({ annotations }), sentences));
  }
});

test('reject unknown labels and empty reasons', () => {
  for (const changes of [{ role: 'invented' }, { priority: 'maybe' }, { reason: '' }]) {
    assert.throws(() => core.parseAnnotations(JSON.stringify({ annotations: [{ ...rows[0], ...changes }, rows[1]] }), sentences));
  }
});

test('fenced JSON is accepted without executing content', () => {
  assert.equal(core.parseAnnotations('```json\n' + JSON.stringify({ annotations: rows }) + '\n```', sentences).length, 2);
});

test('batches retain every sentence exactly once and reject oversize sentences', () => {
  const source = Array.from({ length: 45 }, (_, i) => ({ id: `s${i}`, text: 'sentence' }));
  const batches = core.batchSentences(source);
  assert.deepEqual(batches.flat(), source);
  assert.ok(batches.every(b => b.length <= 20));
  assert.throws(() => core.batchSentences([{ id: 'long', text: 'x'.repeat(12001) }]));
});

test('official, proxy and local API addresses normalize safely', () => {
  assert.equal(core.apiUrl('https://api.deepseek.com/'), 'https://api.deepseek.com/chat/completions');
  assert.equal(core.apiUrl('https://proxy.example/v1'), 'https://proxy.example/v1/chat/completions');
  assert.equal(core.apiUrl('http://localhost:11434/v1/chat/completions'), 'http://localhost:11434/v1/chat/completions');
  for (const url of ['http://remote.example/v1', 'https://user:secret@host/v1', 'https://host/v1?key=secret', 'file:///tmp/test']) {
    assert.throws(() => core.apiUrl(url));
  }
});

test('prompt includes paper context, original sentences and boundary criteria', () => {
  const messages = core.buildMessages({ title: 'DGM', overview: 'Frozen foundation models', outline: ['Methods'] }, sentences, ['Neighbor']);
  assert.match(messages[0].content, /愿景/);
  assert.match(messages[0].content, /否定/);
  assert.match(messages[0].content, /资料/);
  const payload = JSON.parse(messages[1].content);
  assert.equal(payload.paper.title, 'DGM');
  assert.equal(payload.sentences[0].id, 's1');
  assert.deepEqual(payload.neighbors, ['Neighbor']);
});

test('streamed completion survives fragmented UTF-8 chunks and rejects output truncation', async () => {
  const source = 'data: {"choices":[{"delta":{"content":"机制"},"finish_reason":null}]}\r\n\r\n' +
    'data: {"choices":[{"delta":{"content":"说明"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(source);
  const stream = new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
    controller.close();
  } });
  assert.equal(await core.completionText(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })), '机制说明');
  const truncated = new Response('data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  await assert.rejects(() => core.completionText(truncated), /截断/);
});

test('compatible non-streaming JSON response is also accepted', async () => {
  const response = new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'valid' } }] }), { headers: { 'Content-Type': 'application/json' } });
  assert.equal(await core.completionText(response), 'valid');
});
