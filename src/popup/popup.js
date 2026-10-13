/* 弹出面板：当前标签页状态 + 快捷开关 + 一键答题 */
const MSG = {
  GET_CONFIG: 'cq:get-config', SAVE_CONFIG: 'cq:save-config',
  TAB_STATUS: 'cq:tab-status', PAGE_CMD: 'cq:page-cmd', OPEN_OPTIONS: 'cq:open-options'
};
let cfg = null;

function send(msg) { return chrome.runtime.sendMessage(msg); }
async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function init() {
  document.getElementById('ver').textContent = 'v' + (chrome.runtime.getManifest().version || '1.0');
  const c = await send({ type: MSG.GET_CONFIG });
  cfg = c.config;
  bind('autoDetect', cfg.autoDetect); bind('autoAnswer', cfg.autoAnswer);
  bind('previewFirst', cfg.previewFirst); bind('verifyAnswers', cfg.verifyAnswers); bind('autoSubmit', cfg.autoSubmit);
  document.getElementById('apiState').textContent = cfg.apiKey ? '已配置' : '未配置';
  document.getElementById('apiState').style.color = cfg.apiKey ? '#16a34a' : '#dc2626';
  document.getElementById('sub').textContent = '模型：' + (cfg.model || '未配置');
  refreshTab();
}

function bind(id, val) {
  const el = document.getElementById(id);
  el.checked = !!val;
  el.addEventListener('change', async () => {
    cfg = (await send({ type: MSG.SAVE_CONFIG, config: { ...cfg, [id]: el.checked } })).config;
  });
}

async function refreshTab() {
  const tab = await activeTab();
  if (!tab || !/^https?:/.test(tab.url || '')) {
    document.getElementById('pageKind').textContent = '非网页';
    document.getElementById('pageCount').textContent = '';
    return;
  }
  const r = await send({ type: MSG.TAB_STATUS, tabId: tab.id });
  const s = r.status;
  if (!s) {
    document.getElementById('pageKind').textContent = '非学习通答题页';
    document.getElementById('pageCount').textContent = '';
    document.getElementById('btnAnswer').disabled = true;
    return;
  }
  document.getElementById('pageKind').textContent = s.kind || '学习通页面';
  document.getElementById('pageCount').textContent = (s.count || 0) + ' 题' + (s.answered ? '（已答）' : '');
  document.getElementById('btnAnswer').disabled = !s.count;
}

async function pageCmd(cmd) {
  const tab = await activeTab();
  if (!tab) return;
  await chrome.tabs.sendMessage(tab.id, { type: MSG.PAGE_CMD, cmd }).catch(() => {
    document.getElementById('sub').textContent = '请刷新答题页后重试';
  });
  setTimeout(refreshTab, 600);
}

document.getElementById('btnAnswer').addEventListener('click', () => pageCmd('answer'));
document.getElementById('btnRescan').addEventListener('click', () => pageCmd('rescan'));
document.getElementById('btnOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
init();