/* 学习通 AI 自动答题助手  后台 Service Worker
 * 职责：配置存取、标签页状态注册、题目缓存、调用模型 API、解析结果 */
import '../common/constants.js';
import '../common/util.js';
import '../common/store.js';
import { callOpenAI, callAnthropic, callOpenCodeZen, callKilo, callWorkBuddy, extractText, parseAnswerPayload, compareAnswer } from './adapters.js';

const CQ = globalThis.CQ;
const U = CQ.util;

/* 按 provider 分发到对应适配器；zen/kilo 为免密网关，workbuddy 需用户登录令牌 */
async function callProvider(cfg, sys, user, questions, signal) {
  if (cfg.provider === 'anthropic') return callAnthropic(cfg, sys, user, questions, signal);
  if (cfg.provider === 'zen') return callOpenCodeZen(cfg, sys, user, questions, signal);
  if (cfg.provider === 'kilo') return callKilo(cfg, sys, user, questions, signal);
  if (cfg.provider === 'workbuddy') return callWorkBuddy(cfg, sys, user, questions, signal);
  return callOpenAI(cfg, sys, user, questions, signal);
}

chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.get('cqTabs').then(d => {
    const tabs = { ...(d.cqTabs || {}) };
    delete tabs[tabId];
    return chrome.storage.session.set({ cqTabs: tabs });
  }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  CQ.store.get().then(cfg => CQ.store.set(cfg));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  const type = msg.type;
  const p = handle(type, msg, sender);
  if (p && typeof p.then === 'function') {
    p.then(r => sendResponse(r || { ok: true })).catch(e => {
      sendResponse({ ok: false, error: e && e.message ? e.message : String(e) });
    });
    return true; // 保持消息通道
  }
});

async function handle(type, msg, sender) {
  switch (type) {
    case CQ.MSG.GET_CONFIG: return { ok: true, config: await CQ.store.get() };
    case CQ.MSG.SAVE_CONFIG: {
      const cfg = await CQ.store.set(msg.config);
      return { ok: true, config: cfg };
    }
    case CQ.MSG.ANSWER: return answerBatch(msg.questions || []);
    case CQ.MSG.TEST_CONNECTION: return testConnection(msg.config);
    case CQ.MSG.CACHE_GET: return { ok: true, hits: await cacheGet(msg.keys || []) };
    case CQ.MSG.CACHE_SET: await cacheSet(msg.entries || []); return { ok: true };
    case CQ.MSG.CACHE_CLEAR: await chrome.storage.local.remove(CQ.CACHE_KEY); return { ok: true };
    case CQ.MSG.REPORT: return reportTab(msg, sender);
    case CQ.MSG.TAB_STATUS: return tabStatus(msg.tabId);
    case CQ.MSG.PANEL_DECIDE: return panelDecide(msg, sender);
    case CQ.MSG.OPEN_OPTIONS: chrome.runtime.openOptionsPage(); return null;
    default: return null;
  }
}

/* ---------- 题目缓存 ---------- */
async function cacheGet(keys) {
  const data = await chrome.storage.local.get(CQ.CACHE_KEY);
  const cache = data[CQ.CACHE_KEY] || {};
  const hits = {};
  for (const k of keys) if (cache[k]) hits[k] = cache[k];
  return hits;
}

async function cacheSet(entries) {
  const data = await chrome.storage.local.get(CQ.CACHE_KEY);
  const cache = data[CQ.CACHE_KEY] || {};
  for (const e of entries) {
    if (e && e.key && e.value) {
      cache[e.key] = { ...e.value, ts: Date.now() };
    }
  }
  // LRU 上限裁剪
  const keys = Object.keys(cache);
  if (keys.length > CQ.CACHE_MAX) {
    keys.sort((a, b) => (cache[a].ts || 0) - (cache[b].ts || 0));
    for (const k of keys.slice(0, keys.length - CQ.CACHE_MAX)) delete cache[k];
  }
  await chrome.storage.local.set({ [CQ.CACHE_KEY]: cache });
}

/* ---------- 标签页状态注册 ---------- */
async function reportTab(msg, sender) {
  const tabId = msg.tabId || (sender.tab && sender.tab.id);
  if (!tabId) return { ok: false };
  const frameId = msg.frameId || sender.frameId || 0;
  const rec = {
    tabId, frameId, at: Date.now(),
    kind: msg.kind || 'unknown', count: msg.count || 0,
    hasApiKey: !!msg.hasApiKey, answered: !!msg.answered
  };
  const data = await chrome.storage.session.get('cqTabs');
  const tabs = data.cqTabs || {};
  tabs[tabId] = tabs[tabId] || { frames: {} };
  tabs[tabId].frames[frameId] = rec;
  await chrome.storage.session.set({ cqTabs: tabs });
  await updateBadge(tabId, tabs[tabId]);
  return { ok: true };
}

/* ---------- 悬浮窗仲裁：每个标签页只保留一个面板 ---------- */
function pickPanelOwner(frames) {
  const list = Object.values(frames || {});
  if (!list.length) return null;
  const withQ = list.filter(f => (f.count || 0) > 0)
    .sort((a, b) => (b.count - a.count) || ((a.frameId || 0) - (b.frameId || 0)));
  if (withQ.length) return withQ[0].frameId; // 题目最多的框架优先，平局顶层在前
  const top = list.find(f => f.frameId === 0);
  return top ? 0 : null; // 无题时顶层常驻；顶层未运行脚本则不挂
}

async function panelDecide(msg, sender) {
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return { ok: false, mount: false };
  const frameId = (sender.frameId === undefined || sender.frameId === null) ? 0 : sender.frameId;
  const data = await chrome.storage.session.get('cqTabs');
  const tabs = data.cqTabs || {};
  const t = tabs[tabId] || { frames: {} };
  if (!t.frames[frameId]) t.frames[frameId] = { tabId, frameId, at: Date.now(), kind: 'unknown', count: 0 };
  t.frames[frameId].at = Date.now();
  if (typeof msg.count === 'number') t.frames[frameId].count = msg.count; // 以决策时刻框架自报题数为准
  tabs[tabId] = t;
  await chrome.storage.session.set({ cqTabs: tabs });
  const owner = pickPanelOwner(t.frames);
  const ps = await chrome.storage.session.get('cqPanels');
  const panels = ps.cqPanels || {};
  const prevOwner = Object.prototype.hasOwnProperty.call(panels, tabId) ? panels[tabId] : undefined;
  panels[tabId] = owner;
  await chrome.storage.session.set({ cqPanels: panels });
  if (prevOwner !== undefined && prevOwner !== null && prevOwner !== owner) {
    try { await chrome.tabs.sendMessage(tabId, { type: CQ.MSG.PAGE_CMD, cmd: 'unmount' }, { frameId: prevOwner }); } catch (e) { /* 框架可能已销毁 */ }
  }
  if (owner !== null && owner !== undefined && owner !== prevOwner) {
    try { await chrome.tabs.sendMessage(tabId, { type: CQ.MSG.PAGE_CMD, cmd: 'mount' }, { frameId: owner }); } catch (e) { /* ignore */ }
  }
  return { ok: true, mount: owner === frameId };
}

async function tabStatus(tabId) {
  const data = await chrome.storage.session.get('cqTabs');
  const t = (data.cqTabs || {})[tabId];
  if (!t) return { ok: true, status: null };
  const frames = Object.values(t.frames).sort((a, b) => b.count - a.count);
  const best = frames[0] || null;
  return {
    ok: true,
    status: {
      kind: best ? best.kind : 'unknown',
      count: frames.reduce((s, f) => s + (f.count || 0), 0),
      frames: frames.length,
      at: best ? best.at : 0,
      hasApiKey: !!(best && best.hasApiKey),
      answered: frames.some(f => f.answered)
    }
  };
}

async function updateBadge(tabId, t) {
  const frames = Object.values(t.frames || {});
  const count = frames.reduce((s, f) => s + (f.count || 0), 0);
  if (!count) {
    await chrome.action.setBadgeText({ tabId, text: '' });
    return;
  }
  await chrome.action.setBadgeText({ tabId, text: String(Math.min(count, 99)) });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' });
}

/* ---------- 模型调用 ---------- */
async function answerBatch(questions) {
  const cfg = await CQ.store.get();
  const freeLane = cfg.provider === 'zen' || cfg.provider === 'kilo';
  if (!cfg.apiKey && !freeLane && !String(cfg.extraHeaders || '').match(/authorization/i)) {
    return { ok: false, error: '尚未配置 API Key，请点击设置填写。' };
  }
  if (!questions.length) return { ok: true, map: {} };

  const sys = (cfg.systemPrompt && cfg.systemPrompt.trim()) ? cfg.systemPrompt.trim() : CQ.PROMPT.system;
  const user = CQ.PROMPT.userPrefix.replace('{count}', String(questions.length)) + JSON.stringify(questions);

  // 缓存命中
  const keys = questions.map(q => ({ q, key: CQ.store.cacheKeyOf(q) }));
  const hits = cfg.enableCache ? await cacheGet(keys.map(k => k.key)) : {};
  const map = {};
  const miss = [];
  for (const { q, key } of keys) {
    if (hits[key] && Array.isArray(hits[key].answer)) map[q.index] = hits[key];
    else miss.push(q);
  }
  if (!miss.length) return { ok: true, map, cached: Object.keys(map).length, raw: null };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  let resp;
  try {
    resp = await callProvider(cfg, sys, user, miss, controller.signal);
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: '网络请求失败：' + (e && e.message ? e.message : e) };
  }
  clearTimeout(timer);

  let parsed = { ok: false, raw: '' };
  if (!resp.ok) {
    let detail = '';
    try { detail = (await resp.text()).slice(0, 400); } catch (e) { /* ignore */ }
    parsed.error = 'API 返回 ' + resp.status + '：' + detail;
  } else {
    const out = await extractText(resp, cfg.provider);
    let textOut = out.text;
    if (isHtmlPayload(textOut)) {
      // 常见配置错误：API 地址填成了网站地址 → 自动补 /v1 再试一次
      const alt = altBaseUrl(cfg.baseUrl);
      if (alt && alt !== cfg.baseUrl) {
        try {
          const ac = new AbortController();
          const at = setTimeout(() => ac.abort(), cfg.timeoutMs);
          const r4 = await callProvider({ ...cfg, baseUrl: alt }, sys, user, miss, ac.signal);
          clearTimeout(at);
          if (r4.ok) {
            const o4 = await extractText(r4, cfg.provider);
            if (!isHtmlPayload(o4.text)) textOut = o4.text;
          }
        } catch (e) { /* ignore */ }
      }
    }
    parsed = isHtmlPayload(textOut)
      ? { ok: false, raw: textOut, error: '返回的是网页 HTML 而不是 API 数据：API 地址可能填成了网站地址。中转站接口地址通常以 /v1 结尾（如 https://xxx.com/v1），请修改后重试。' }
      : parseAnswerPayload(textOut);

    // 解析失败重试一次（把上次原文附上）
    if (!parsed.ok) {
      const retryUser = CQ.PROMPT.retry + '\n' + out.text.slice(0, 2000);
      try {
        const rc = new AbortController();
        const rt = setTimeout(() => rc.abort(), cfg.timeoutMs);
        const r2 = await callProvider({ ...cfg, maxTokens: Math.max(cfg.maxTokens || 0, 4096) }, sys, retryUser, miss, rc.signal);
        clearTimeout(rt);
        if (r2.ok) {
          const o2 = await extractText(r2, cfg.provider);
          parsed = parseAnswerPayload(o2.text);
          parsed.raw = out.text + '\n---retry---\n' + o2.text;
        }
      } catch (e) { /* 保留第一次解析失败 */ }
    }
  }

  // 仍失败且题目较多：按 2 题一批分批重试（思考型模型整批输出易超 max_tokens 被截断）
  if (!parsed.ok && miss.length > 1) {
    const merged = new Map();
    let chunkFail = '';
    const CHUNK = 2;
    for (let i = 0; i < miss.length; i += CHUNK) {
      const part = miss.slice(i, i + CHUNK);
      const partUser = CQ.PROMPT.userPrefix.replace('{count}', String(part.length)) + JSON.stringify(part);
      const label = '第' + part[0].index + (part.length > 1 ? '-' + part[part.length - 1].index : '') + '题';
      try {
        const cc = new AbortController();
        const ct = setTimeout(() => cc.abort(), cfg.timeoutMs);
        const r3 = await callProvider({ ...cfg, maxTokens: Math.max(cfg.maxTokens || 0, 4096) }, sys, partUser, part, cc.signal);
        clearTimeout(ct);
        if (r3.ok) {
          const o3 = await extractText(r3, cfg.provider);
          const p3 = parseAnswerPayload(o3.text);
          if (p3.ok) {
            for (const [k, v] of p3.map) merged.set(k, v);
          } else {
            chunkFail += '；' + label + '解析失败：' + o3.text.slice(0, 120);
          }
        } else {
          chunkFail += '；' + label + ' HTTP ' + r3.status;
        }
      } catch (e) {
        chunkFail += '；' + label + '请求异常';
      }
    }
    if (merged.size) {
      parsed = { ok: true, map: merged, raw: (parsed.raw || '') + '\n---chunked---' + chunkFail };
    } else {
      parsed.error = (parsed.error || '') + '；分批重试也全部失败' + chunkFail;
      if (!parsed.raw) parsed.raw = '';
    }
  }

  if (!parsed.ok) {
    return { ok: false, error: parsed.error, raw: parsed.raw };
  }

  Object.assign(map, Object.fromEntries(parsed.map));

  // 答案检测（v1.2.0）：对首次回答做一次独立核验；不一致的题单独重答
  let verifyStat = null;
  if (cfg.verifyAnswers && miss.length) {
    verifyStat = { consistent: 0, rewritten: 0, failed: 0 };
    let verifyMap = null;
    try {
      const vc = new AbortController();
      const vt = setTimeout(() => vc.abort(), cfg.timeoutMs);
      const vr = await callProvider(cfg, sys, user, miss, vc.signal);
      clearTimeout(vt);
      if (vr.ok) {
        const vo = await extractText(vr, cfg.provider);
        const vp = parseAnswerPayload(vo.text);
        if (vp.ok) verifyMap = vp.map;
      }
    } catch (e) { /* 核验请求失败：保留首次答案 */ }

    if (!verifyMap) {
      for (const q of miss) {
        const v1 = map[q.index];
        if (v1) { v1.verify = 'kept'; v1.reason2 = '答案检测：核验请求失败，保留首次答案'; }
      }
      verifyStat.failed = miss.length;
    } else {
      const mismatch = [];
      for (const q of miss) {
        const v1 = map[q.index];
        const v2 = verifyMap.get(q.index);
        if (v1 && v2 && Array.isArray(v2.answer) && compareAnswer(v1.answer, v2.answer)) {
          v1.verify = 'consistent';
          verifyStat.consistent++;
        } else if (v1) {
          mismatch.push(q);
        }
      }
      for (const q of mismatch) {
        const oneUser = CQ.PROMPT.userPrefix.replace('{count}', '1') + JSON.stringify([q]);
        let replaced = false;
        try {
          const oc = new AbortController();
          const ot = setTimeout(() => oc.abort(), cfg.timeoutMs);
          const or = await callProvider(cfg, sys, oneUser, [q], oc.signal);
          clearTimeout(ot);
          if (or.ok) {
            const oo = await extractText(or, cfg.provider);
            const op = parseAnswerPayload(oo.text);
            const nv = op.ok ? op.map.get(q.index) : null;
            if (nv && Array.isArray(nv.answer) && nv.answer.length) {
              nv.verify = 'rewritten';
              nv.reason2 = '答案检测：与首次回答不一致，已单独重新回答';
              map[q.index] = nv;
              verifyStat.rewritten++;
              replaced = true;
            }
          }
        } catch (e) { /* 单题重答失败：保留首次答案 */ }
        if (!replaced) {
          const v1 = map[q.index];
          if (v1) { v1.verify = 'kept'; v1.reason2 = '答案检测：核验不一致但单独重答失败，保留首次答案'; }
          verifyStat.failed++;
        }
      }
    }
  }

  // 写回缓存
  if (cfg.enableCache) {
    const entries = [];
    for (const { q, key } of keys) {
      const v = map[q.index]; // 答案检测后：以最终答案为准写缓存
      if (v && v.answer && v.answer.length) entries.push({ key, value: v });
    }
    if (entries.length) cacheSet(entries);
  }
  return { ok: true, map, cached: 0, raw: parsed.raw, model: cfg.model, verify: verifyStat };
}

/* 中转站把网站首页当接口返回 HTML 时的识别与备用地址 */
function isHtmlPayload(text) {
  return /^\s*<(!doctype|html|\?xml|head|body)/i.test(String(text || '').slice(0, 200));
}
function altBaseUrl(base) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) return b;
  if (/\/v\d+[a-z]*$/i.test(b)) return b;
  return b + '/v1';
}

async function testConnection(cfgRaw) {
  const cfg = CQ.store.normalize(cfgRaw);
  const q = [{ index: 1, type: 'single', stem: '中国的首都是哪座城市？', options: [{ key: 'A', label: '上海' }, { key: 'B', label: '北京' }, { key: 'C', label: '广州' }] }];
  const user = CQ.PROMPT.userPrefix.replace('{count}', '1') + JSON.stringify(q);
  const sys = CQ.PROMPT.system;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(cfg.timeoutMs, 30000));
  try {
    const resp = await callProvider(cfg, sys, user, q, controller.signal);
    clearTimeout(timer);
    if (!resp.ok) {
      const detail = (await resp.text().catch(() => '')).slice(0, 300);
      return { ok: false, error: `HTTP ${resp.status}：${detail}` };
    }
    const out = await extractText(resp, cfg.provider);
    if (isHtmlPayload(out.text)) {
      return { ok: false, error: '返回的是网页 HTML 而不是 API 数据：API 地址可能填成了网站地址。中转站接口地址通常以 /v1 结尾（如 https://xxx.com/v1）。' };
    }
    const parsed = parseAnswerPayload(out.text);
    if (!parsed.ok) return { ok: false, error: '连通成功但输出解析失败：' + out.text.slice(0, 300) };
    const v = parsed.map.get(1);
    const used = (resp.modelUsed && resp.modelUsed !== cfg.model) ? resp.modelUsed : null;
    return {
      ok: true,
      sample: v ? v.answer.join('、') : '',
      model: used || cfg.model,
      note: used ? `预设模型 ${cfg.model} 当前不可路由，已自动切换为 ${used}。请到设置页把模型名改为 ${used}。` : ''
    };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, error: '请求失败：' + (e && e.message ? e.message : e) + '（请确认已在设置页申请对应站点的访问权限）' };
  }
}