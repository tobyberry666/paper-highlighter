const fields = ['baseUrl', 'model', 'apiKey'];
const status = document.querySelector('#status');
chrome.storage.local.get('settings').then(({ settings }) => {
  const values = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: '', ...settings };
  fields.forEach(name => { document.getElementById(name).value = values[name]; });
});
function values() { return Object.fromEntries(fields.map(name => [name, document.getElementById(name).value.trim()])); }
async function save() {
  const settings = values();
  const endpoint = PaperCore.apiUrl(settings.baseUrl);
  if (!settings.model || !settings.apiKey) throw new Error('请填写模型名和 API Key。');
  // Called directly from a user gesture; only grant the configured service's origin.
  const granted = await chrome.permissions.request({ origins: [new URL(endpoint).origin + '/*'] });
  if (!granted) throw new Error('没有获得接口访问权限，设置未保存。');
  await chrome.storage.local.set({ settings });
}
document.querySelector('#form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await save(); status.textContent = '设置已保存。返回论文页面，点击“分析重点”。'; }
  catch (error) { status.textContent = error.message; }
});
document.querySelector('#test').addEventListener('click', async () => {
  try {
    await save(); status.textContent = '正在测试连接…';
    const response = await chrome.runtime.sendMessage({ type: 'classify', context: { title: '接口测试', overview: '', outline: [] }, neighbors: [], sentences: [{ id: 'test', language: 'en', section: 'Methods', text: 'Each modified agent is evaluated using a coding benchmark.' }] });
    if (!response?.ok) throw new Error(response?.error || '后台没有响应。');
    status.textContent = '连接成功，模型已返回有效的句子分类。';
  } catch (error) { status.textContent = error.message; }
});
