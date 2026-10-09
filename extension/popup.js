let tab;
const status = document.querySelector('#status');
async function command(type) {
  try {
    if (!tab) throw new Error('请先打开 arXiv HTML 论文页面。');
    const result = await chrome.tabs.sendMessage(tab.id, { type });
    status.textContent = result.status;
    document.querySelector('#start').disabled = result.running;
    document.querySelector('#stop').hidden = !result.running;
  } catch { status.textContent = '请打开 arXiv 的 HTML 论文页面；安装扩展后需刷新已有页面。'; }
}
for (const type of ['start', 'stop', 'toggle', 'clear']) document.querySelector('#' + type).addEventListener('click', () => command(type));
document.querySelector('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.tabs.query({ active: true, currentWindow: true }).then(tabs => { tab = tabs[0]; command('status'); });
setInterval(() => command('status'), 700);
