/* 设置页：自动保存 + 连接测试 + 站点权限申请 + 导入导出 */
const MSG = {
  GET_CONFIG: 'cq:get-config', SAVE_CONFIG: 'cq:save-config',
  TEST_CONNECTION: 'cq:test-connection', CACHE_CLEAR: 'cq:cache-clear'
};
const send = m => chrome.runtime.sendMessage(m);

const TEXT_FIELDS = ['provider', 'model', 'baseUrl', 'apiKey', 'extraHeaders', 'systemPrompt'];
const NUM_FIELDS = ['temperature', 'maxTokens', 'timeoutMs', 'batchSize', 'requestDelayMs', 'minConfidence'];
const BOOL_FIELDS = ['autoDetect', 'autoAnswer', 'previewFirst', 'enableCache', 'verifyAnswers', 'includeImages', 'autoSubmit', 'autoNext'];

let cfg = null;

async function init() {
  document.getElementById('ver').textContent = chrome.runtime.getManifest().version || '1.0';
  const r = await send({ type: MSG.GET_CONFIG });
  cfg = r.config || {};
  TEXT_FIELDS.forEach(f => { document.getElementById(f).value = cfg[f] ?? ''; });
  NUM_FIELDS.forEach(f => { document.getElementById(f).value = cfg[f] ?? ''; });
  BOOL_FIELDS.forEach(f => { document.getElementById(f).checked = !!cfg[f]; });
  populateModelPreset();
  updateVisionHint();
  attach();
}

function collect() {
  const out = { ...cfg };
  TEXT_FIELDS.forEach(f => { out[f] = document.getElementById(f).value; });
  NUM_FIELDS.forEach(f => { out[f] = Number(document.getElementById(f).value); });
  BOOL_FIELDS.forEach(f => { out[f] = document.getElementById(f).checked; });
  return out;
}

let saveTimer = null;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const r = await send({ type: MSG.SAVE_CONFIG, config: collect() });
    cfg = r.config || cfg;
    out('已自动保存', 'ok');
  }, 400);
}

function populateModelPreset() {
  const sel = document.getElementById('modelPreset');
  const presets = (globalThis.CQ && CQ.MODEL_PRESETS) || [];
  sel.innerHTML = '<option value="">自定义（手动输入模型名）</option>';
  for (const p of presets) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.label + (p.vision ? '  支持视觉' : '');
    opt.dataset.provider = p.provider || '';
    opt.dataset.baseUrl = p.baseUrl || '';
    opt.dataset.vision = p.vision ? '1' : '';
    sel.appendChild(opt);
  }
  const cur = String((cfg && cfg.model) || '');
  sel.value = [...sel.options].some(x => x.value === cur) ? cur : '';
}

function updateVisionHint() {
  const hint = document.getElementById('visionHint');
  if (!hint) return;
  if (!document.getElementById('includeImages').checked) { hint.textContent = ''; return; }
  const model = document.getElementById('model').value.trim();
  const p = ((globalThis.CQ && CQ.MODEL_PRESETS) || []).find(x => x.name === model);
  if (p && p.vision) hint.textContent = ' 当前预设模型支持视觉输入，题干图片会随题目一起发送。';
  else if (p) hint.textContent = ' 当前预设模型不支持视觉输入，建议换成标注「支持视觉」的模型（如 gpt-4o / qwen-vl-plus / glm-4v-flash）。';
  else hint.textContent = ' 已启用视觉模型：请确认所填模型支持图像输入（OpenAI 兼容接口需支持 image_url 内容）。';
}

function out(text, tone) {
  const el = document.getElementById('testOut');
  el.textContent = text;
  el.className = 'out' + (tone ? ' ' + tone : '');
}

function attach() {
  if (attach.done) return;
  attach.done = true;
  [...TEXT_FIELDS, ...NUM_FIELDS].forEach(f => {
    document.getElementById(f).addEventListener('input', autosave);
    document.getElementById(f).addEventListener('change', autosave);
  });
  BOOL_FIELDS.forEach(f => {
    document.getElementById(f).addEventListener('change', autosave);
  });

  document.getElementById('modelPreset').addEventListener('change', () => {
    const sel = document.getElementById('modelPreset');
    const opt = sel.selectedOptions[0];
    if (sel.value && opt) {
      document.getElementById('model').value = sel.value;
      if (opt.dataset.provider) document.getElementById('provider').value = opt.dataset.provider;
      if (opt.dataset.baseUrl) document.getElementById('baseUrl').value = opt.dataset.baseUrl;
      if (opt.dataset.provider === 'zen' || opt.dataset.provider === 'kilo') {
        document.getElementById('apiKey').value = '';
      }
      autosave();
    }
    updateVisionHint();
  });
  document.getElementById('model').addEventListener('input', () => {
    const sel = document.getElementById('modelPreset');
    if (sel.value && sel.value !== document.getElementById('model').value.trim()) sel.value = '';
  });
  document.getElementById('includeImages').addEventListener('change', updateVisionHint);

  document.getElementById('showKey').addEventListener('click', () => {
    const el = document.getElementById('apiKey');
    el.type = el.type === 'password' ? 'text' : 'password';
  });

  document.getElementById('test').addEventListener('click', async () => {
    const c = collect();
    const freeLane = c.provider === 'zen' || c.provider === 'kilo';
    if (!c.apiKey && !freeLane && !/authorization/i.test(c.extraHeaders || '')) {
      out('请先填写 API Key（或自定义 Authorization 头）', 'err');
      return;
    }
    out('连接测试中', '');
    const r = await send({ type: MSG.TEST_CONNECTION, config: c });
    out(r.ok ? `连接成功  示例答案：${r.sample || ''}${r.note ? '  ' + r.note : ''}` : `失败  ${r.error}`, r.ok ? 'ok' : 'err');
  });

  document.getElementById('grantHost').addEventListener('click', async () => {
    const c = collect();
    let origin = null;
    try { origin = new URL(c.baseUrl).origin; } catch (e) { /* ignore */ }
    if (!origin || !/^https?:/.test(origin)) {
      out('API 地址不是合法 URL：' + c.baseUrl, 'err');
      return;
    }
    const perm = { origins: [origin + '/*'] };
    chrome.permissions.request(perm, granted => {
      out(granted ? '已授予 ' + origin + ' 的访问权限 ' : '授权被拒绝或已授权', granted ? 'ok' : 'err');
    });
  });

  document.getElementById('clearCache').addEventListener('click', async () => {
    await send({ type: MSG.CACHE_CLEAR });
    out('题库缓存已清空', 'ok');
  });

  document.getElementById('export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(collect(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'chaoxing-ai-answer-config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('import').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      const r = await send({ type: MSG.SAVE_CONFIG, config: { ...collect(), ...obj } });
      cfg = r.config;
      init();
      out('配置已导入', 'ok');
    } catch (err) {
      out('导入失败：' + err.message, 'err');
    }
  });
}

init();