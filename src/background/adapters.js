/* 学习通 AI 自动答题助手  模型 API 适配器（后台 Service Worker 内运行） */
import '../common/constants.js';
import '../common/util.js';
const CQ = globalThis.CQ;

function joinUrl(base, path) {
  const b = String(base || '').replace(/\/+$/, '');
  if (b.endsWith('/chat/completions') || b.endsWith('/messages')) return b;
  return b + path;
}

function parseExtraHeaders(s) {
  const out = {};
  String(s || '').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  });
  return out;
}

function buildUserContent(cfg, text, questions) {
  if (!cfg.includeImages || cfg.provider !== 'openai') return text;
  const imgs = [];
  for (const q of questions || []) for (const url of (q.images || [])) {
    if (/^https?:\/\//.test(url) && imgs.length < 20) imgs.push({ type: 'image_url', image_url: { url } });
  }
  if (!imgs.length) return text;
  return [{ type: 'text', text }, ...imgs];
}

/* Anthropic 视觉：图片以 image 块随题目发送（需模型支持视觉） */
function buildAnthropicUserContent(cfg, user, questions) {
  if (!cfg.includeImages) return user;
  const imgs = [];
  for (const q of questions || []) for (const url of (q.images || [])) {
    if (/^https?:\/\//.test(url) && imgs.length < 20) imgs.push({ type: 'image', source: { type: 'url', url } });
  }
  if (!imgs.length) return user;
  return [{ type: 'text', text: user }, ...imgs];
}

export async function callOpenAI(cfg, system, user, questions, signal) {
  const headers = {
    'Content-Type': 'application/json',
    ...parseExtraHeaders(cfg.extraHeaders)
  };
  if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey.trim();
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: buildUserContent(cfg, user, questions) }
    ],
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream: false
  };
  return fetch(joinUrl(cfg.baseUrl, '/chat/completions'), {
    method: 'POST', headers, body: JSON.stringify(body), signal
  });
}

/* OpenCode Zen 免密网关（opencode.ai/zen）：公开凭据 + 客户端指纹头 + 免费层工具诱饵 */
const ZEN_BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZEN_TOOLS = ['bash', 'glob', 'grep', 'read'].map(name => ({
  type: 'function',
  function: {
    name,
    description: 'This tool is currently unavailable and must not be used.',
    parameters: { type: 'object', properties: {} }
  }
}));

function zenRand(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return a;
}

function zenHex(timestamp) {
  const value = ~(BigInt(timestamp) * 0x1000n + 1n);
  let hex = '';
  for (let i = 0; i < 6; i += 1) hex += Number((value >> BigInt(40 - 8 * i)) & 0xffn).toString(16).padStart(2, '0');
  return hex;
}

function zenB62(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += ZEN_BASE62[bytes[i] % 62];
  return out;
}

/* 免费层配额按 session 计：跨重启复用同一个 ses_ id；msg_ id 每次请求新铸造 */
async function zenSessionId() {
  const key = 'cq-zen-session';
  try {
    const d = await chrome.storage.local.get(key);
    if (d && d[key]) return d[key];
  } catch (e) { /* ignore */ }
  const sid = 'ses_' + zenHex(Date.now()) + zenB62(zenRand(14));
  try { await chrome.storage.local.set({ [key]: sid }); } catch (e) { /* ignore */ }
  return sid;
}

function zenRequestId() {
  return 'msg_' + zenHex(Date.now()) + zenB62(zenRand(14));
}

/* 匿名免费车道只路由清单中的一部分模型：网关对已声明但不可路由的模型返回
   Model is unavailable / 404，个别地区返回 RegionError。此处维护当前 -free 候选池
   （不含 muse-spark：其走 /responses 端点），失败时自动顺延尝试。 */
const ZEN_FALLBACKS = [
  'big-pickle',
  'ling-3.1-flash-free',
  'mimo-v2.6-flash-free',
  'nemotron-3.5-lightning-free',
  'jev-1.13-free',
  'step-5-preview-free',
  'longcat-2.5-preview-free',
  'space-bunny-free'
];

/* SSE->JSON: upstream free tier forces stream:true (stream:false is hard-403). */
function zenParseStream(text) {
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed);
      const c = j.choices && j.choices[0];
      let content = '';
      let reasoning = '';
      if (c && c.message && c.message.content != null) content = String(c.message.content);
      else if (c && c.text != null) content = String(c.text);
      else if (j.output_text != null) content = String(j.output_text);
      if (c && c.message && c.message.reasoning_content != null) reasoning = String(c.message.reasoning_content);
      return { content, reasoning };
    } catch (e) { /* fall through to SSE */ }
  }
  let content = '';
  let reasoning = '';
  for (const line of trimmed.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    let j;
    try { j = JSON.parse(payload); } catch (e) { continue; }
    const c = j.choices && j.choices[0];
    if (c && c.delta) {
      if (typeof c.delta.content === 'string') content += c.delta.content;
      if (typeof c.delta.reasoning_content === 'string') reasoning += c.delta.reasoning_content;
    } else if (c && c.message && typeof c.message.content === 'string') {
      content += c.message.content;
    } else if (j.output_text != null) {
      content += String(j.output_text);
    }
  }
  return { content, reasoning };
}

export async function callOpenCodeZen(cfg, system, user, questions, signal) {
  /* Live-verified 2026-10: /zen/v1 + Bearer public + fingerprint + stream:true = 200 SSE. */
  const base = cfg.baseUrl || 'https://opencode.ai/zen/v1';
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    ...parseExtraHeaders(cfg.extraHeaders),
    'Authorization': cfg.apiKey ? 'Bearer ' + cfg.apiKey.trim() : 'Bearer public',
    'User-Agent': 'opencode/1.18.31',
    'x-opencode-client': 'desktop',
    'x-opencode-session': await zenSessionId(),
    'x-opencode-request': zenRequestId(),
    'x-opencode-project': 'global'
  };
  const common = {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: buildUserContent(cfg, user, questions) }
    ],
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream: true,
    tools: ZEN_TOOLS,
    tool_choice: 'none'
  };
  const preferred = [cfg.model].concat(ZEN_FALLBACKS.filter(m => m !== cfg.model));
  let last = null;
  for (let i = 0; i < preferred.length; i += 1) {
    const resp = await fetch(joinUrl(base, '/chat/completions'), {
      method: 'POST', headers,
      body: JSON.stringify(Object.assign({ model: preferred[i] }, common)),
      signal
    });
    if (resp.ok) {
      const text = await resp.text().catch(() => '');
      const parsed = zenParseStream(text);
      const payload = {
        choices: [{
          message: {
            role: 'assistant',
            content: parsed.content || null,
            reasoning_content: parsed.reasoning || undefined
          }
        }]
      };
      const syn = new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
      syn.modelUsed = preferred[i];
      return syn;
    }
    last = resp;
    if (i < preferred.length - 1) {
      const text = await resp.clone().text().catch(() => '');
      if (resp.status === 404 || /Model is unavailable|not found|RegionError|region-limited/i.test(text)) continue;
    }
    return resp;
  }
  return last;
}

/* Kilo 免密网关（api.kilo.ai/api/gateway）：免费池模型无鉴权 */
export async function callKilo(cfg, system, user, questions, signal) {
  const headers = {
    'Content-Type': 'application/json',
    ...parseExtraHeaders(cfg.extraHeaders)
  };
  if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey.trim();
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: buildUserContent(cfg, user, questions) }
    ],
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream: false
  };
  return fetch(joinUrl(cfg.baseUrl, '/chat/completions'), {
    method: 'POST', headers, body: JSON.stringify(body), signal
  });
}

/* WorkBuddy 渠道（copilot.tencent.com / www.workbuddy.ai）：复用用户 WorkBuddy 账号令牌（扣个人积分）。
 * 上游强制 stream:true；身份字段缺省时按官方 CLI 惯例发送 X-No-* 标记。
 * 可选身份：在「自定义请求头」填 X-User-Id / X-Enterprise-Id / X-Domain 可替换对应 X-No-*。 */
function wbRegion(baseUrl) {
  const host = String((baseUrl || '').replace(/^https?:\/\//i, '').split('/')[0] || '').toLowerCase();
  return host === 'www.workbuddy.ai' || host === 'workbuddy.ai' || host.endsWith('.workbuddy.ai') ? 'global' : 'cn';
}

export async function callWorkBuddy(cfg, system, user, questions, signal) {
  const base = cfg.baseUrl || 'https://copilot.tencent.com';
  const region = wbRegion(base);
  const clientVersion = region === 'global' ? '5.6.2' : '5.5.6';
  const product = region === 'global' ? 'WorkBuddy AI' : 'WorkBuddy';
  const origin = region === 'global' ? 'https://www.workbuddy.ai' : 'https://www.codebuddy.cn';
  const extra = parseExtraHeaders(cfg.extraHeaders);
  const uid = extra['X-User-Id'] || '';
  const ent = extra['X-Enterprise-Id'] || '';
  const dom = extra['X-Domain'] || '';
  const headers = {
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    'Origin': origin,
    'Referer': origin + '/',
    'User-Agent': product + '/' + clientVersion + ' ' + product + '/' + clientVersion,
    'Content-Type': 'application/json',
    ...extra,
    'Authorization': 'Bearer ' + String(cfg.apiKey || '').trim()
  };
  if (uid) headers['X-User-Id'] = uid; else headers['X-No-User-Id'] = '1';
  if (ent) headers['X-Enterprise-Id'] = ent; else headers['X-No-Enterprise-Id'] = '1';
  if (dom) headers['X-Domain'] = dom; else headers['X-No-Department-Info'] = '1';
  headers['X-IDE-Type'] = 'WorkBuddy';
  headers['X-IDE-Name'] = 'WorkBuddy';
  headers['X-IDE-Version'] = clientVersion;
  headers['X-Product'] = 'SaaS';
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: buildUserContent(cfg, user, questions) }
    ],
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream: true
  };
  const resp = await fetch(joinUrl(base, '/v2/chat/completions'), {
    method: 'POST', headers, body: JSON.stringify(body), signal
  });
  if (resp.ok) {
    const text = await resp.text().catch(() => '');
    const parsed = zenParseStream(text);
    const payload = {
      choices: [{
        message: {
          role: 'assistant',
          content: parsed.content || null,
          reasoning_content: parsed.reasoning || undefined
        }
      }]
    };
    const syn = new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
    syn.modelUsed = cfg.model;
    return syn;
  }
  return resp;
}
export async function callAnthropic(cfg, system, user, questions, signal) {
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': cfg.apiKey.trim(),
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
    ...parseExtraHeaders(cfg.extraHeaders)
  };
  const body = {
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    temperature: cfg.temperature,
    system,
    messages: [{ role: 'user', content: buildAnthropicUserContent(cfg, user, questions) }]
  };
  return fetch(joinUrl(cfg.baseUrl, '/v1/messages'), {
    method: 'POST', headers, body: JSON.stringify(body), signal
  });
}

/* 提取模型回复文本 */
export async function extractText(resp, provider) {
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('json')) {
    const t = await resp.text();
    return { text: t, raw: t };
  }
  const data = await resp.json();
  if (provider === 'anthropic') {
    const text = (data.content || []).map(b => b.text || '').join('');
    return { text, raw: JSON.stringify(data) };
  }
  const msg = ((data.choices || [])[0] || {}).message || {};
  let text = msg.content;
  if ((text == null || text === '') && msg.reasoning_content != null && msg.reasoning_content !== '') text = msg.reasoning_content;
  const t = Array.isArray(text) ? text.map(x => x.text || '').join('') : String(text || '');
  return { text: t, raw: JSON.stringify(data) };
}

/* 解析模型输出为按题号索引的答案映射 */
export function parseAnswerPayload(text) {
  const CQ2 = globalThis.CQ;
  let data = CQ2.util.parseLooseJson(text);
  if (data && !Array.isArray(data)) {
    if (Array.isArray(data.answers)) data = data.answers;
    else if (Array.isArray(data.result)) data = data.result;
    else if (Array.isArray(data.data)) data = data.data;
    else data = null;
  }
  if (!Array.isArray(data)) return { ok: false, raw: String(text), error: '输出不是 JSON 数组' };

  const map = new Map();
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const idx = Number(item.index ?? item.i ?? item.no ?? item.id ?? item.qid);
    if (!Number.isFinite(idx)) continue;
    let ans = item.answer ?? item.answers ?? item.result ?? [];
    if (typeof ans === 'string') ans = splitAnswerString(ans);
    if (!Array.isArray(ans)) ans = [];
    ans = ans.map(a => String(a == null ? '' : a).trim()).filter(Boolean);
    map.set(idx, {
      answer: ans,
      confidence: Math.min(1, Math.max(0, Number(item.confidence ?? item.score ?? 0.8))),
      reason: String(item.reason ?? item.explain ?? '').slice(0, 120)
    });
  }
  return { ok: true, raw: String(text), map };
}

/* 答案一致性比较（全角/半角、大小写、顺序无关；空答案永不相等）；「答案检测」核验用 */
export function compareAnswer(a, b) {
  const norm = x => (Array.isArray(x) ? x : [x])
    .map(s => String(s == null ? '' : s).trim())
    .map(s => s.replace(/[\uFF01-\uFF5E]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)))
    .map(s => s.toUpperCase())
    .map(s => s.replace(/[\s,，、.。:：;；/]+/g, ''))
    .filter(Boolean)
    .sort()
    .join('\u0000');
  const na = norm(a), nb = norm(b);
  return na !== '' && na === nb;
}

/* "A、C" / "AB" / "对、错" 之类的字符串答案拆分 */
function splitAnswerString(s) {
  const t = String(s || '').trim();
  if (!t) return [];
  if (/^[A-Ha-h]{2,}$/.test(t)) return t.toUpperCase().split('');
  return t.split(/[、,，;；\s/]+/).map(x => x.trim()).filter(Boolean);
}