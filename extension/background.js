importScripts('core.js');

// Content scripts never receive the stored API key.
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const requests = new Map();
const defaults = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: '' };

async function classify(message, sender) {
  const key = sender.tab?.id ?? sender.url;
  if (requests.has(key)) throw new Error('当前页面仍有请求进行中，请稍后再试。');
  const controller = new AbortController();
  // Register synchronously, so stopping during configuration reads also cancels.
  requests.set(key, controller);
  // Streaming starts the response early; API activity keeps this bounded request alive.
  const timeout = setTimeout(() => controller.abort(), 90000);
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo().catch(() => {}), 20000);
  try {
    await storageReady;
    const settings = { ...defaults, ...(await chrome.storage.local.get('settings')).settings };
    controller.signal.throwIfAborted();
    if (!settings.model?.trim() || !settings.apiKey?.trim()) throw new Error('请先在扩展设置中填写模型名和 API Key。');
    const endpoint = PaperCore.apiUrl(settings.baseUrl);
    const permission = new URL(endpoint).origin + '/*';
    if (!await chrome.permissions.contains({ origins: [permission] })) throw new Error('接口访问权限未授权，请打开设置并重新保存。');
    controller.signal.throwIfAborted();
    const sentences = message.sentences;
    if (!Array.isArray(sentences) || !sentences.length || sentences.length > 20 ||
        new Set(sentences.map(s => s?.id)).size !== sentences.length ||
        sentences.some(s => !s || typeof s.id !== 'string' || typeof s.text !== 'string' || !s.text.trim()) ||
        JSON.stringify(message).length > 45000) throw new Error('待分析数据不合法或过长。');
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey.trim()}` },
      body: JSON.stringify({
        model: settings.model.trim(), messages: PaperCore.buildMessages(message.context, sentences, message.neighbors),
        response_format: { type: 'json_object' }, max_tokens: 4096, stream: true,
        ...(new URL(endpoint).hostname === 'api.deepseek.com' ? { thinking: { type: 'disabled' } } : {})
      }), signal: controller.signal, redirect: 'error'
    });
    if (!response.ok) {
      const explanations = { 401: '密钥无效或已过期', 402: '接口账户余额不足', 403: '接口拒绝访问', 429: '接口限流，请稍后重试' };
      throw new Error(`接口返回 ${response.status}：${explanations[response.status] || '请检查接口地址、模型名及服务兼容性'}。`);
    }
    return PaperCore.parseAnnotations(await PaperCore.completionText(response), sentences);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求已停止或超时。');
    if (error instanceof TypeError) throw new Error('无法连接模型接口，请检查地址和网络。');
    throw error;
  } finally {
    clearTimeout(timeout);
    clearInterval(keepAlive);
    if (requests.get(key) === controller) requests.delete(key);
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const extensionPage = sender.url?.startsWith(chrome.runtime.getURL(''));
  let paperPage = false;
  try { const url = new URL(sender.url); paperPage = !!sender.tab && url.origin === 'https://arxiv.org' && url.pathname.startsWith('/html/'); } catch {}
  if (!extensionPage && !paperPage) return;
  const key = sender.tab?.id ?? sender.url;
  if (message.type === 'abort') { requests.get(key)?.abort(); requests.delete(key); reply({ ok: true }); return; }
  if (message.type !== 'classify') return;
  classify(message, sender).then(annotations => reply({ ok: true, annotations }), error => reply({ ok: false, error: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener(id => { requests.get(id)?.abort(); requests.delete(id); });
