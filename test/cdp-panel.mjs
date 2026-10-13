// test/cdp-panel.mjs  悬浮窗回归：答题页与非答题页面板都应挂载
import fs from 'node:fs';
import path from 'node:path';

const PORT = 9333;
const ROOT = 'D:/chaoxing-ai-answer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jsonList() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  if (!r.ok) throw new Error('debugger not reachable: ' + r.status);
  return r.json();
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws error')); });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else events.push(m);
  };
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  return { ws, send, events };
}

const PANEL_EXPR = `(() => {
  const host = document.getElementById('cq-ai-panel-host');
  let status = null, pill = null;
  if (host && host.shadowRoot) {
    const s = host.shadowRoot.querySelector('[data-status]');
    const p = host.shadowRoot.querySelector('[data-pill]');
    status = s && s.textContent;
    pill = p && p.textContent;
  }
  let det = null;
  try { det = CQ.extractor.detectPage(document); } catch (e) { det = { err: String(e) }; }
  return { mounted: !!host, hosts: document.querySelectorAll('#cq-ai-panel-host').length, status, pill, count: CQ.extractor.scan(document).questions.length, det };
})()`;

const DRAG_EXPR = `(() => {
  const host = document.getElementById('cq-ai-panel-host');
  if (!host) return { err: 'no host' };
  const head = host.shadowRoot.querySelector('[data-head]');
  try { head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 60, clientY: 60, pointerId: 99 })); } catch (e) {}
  head.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 99999, clientY: 99999, pointerId: 99 }));
  const r = host.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight };
})()`;

const FRAME_EXPR = `(() => {
  const hosts = (sel) => {
    try {
      const f = document.querySelector(sel);
      return f && f.contentDocument ? f.contentDocument.querySelectorAll('#cq-ai-panel-host').length : -2;
    } catch (e) { return -3; }
  };
  return { topHosts: document.querySelectorAll('#cq-ai-panel-host').length, qFrameHosts: hosts('iframe#q'), vFrameHosts: hosts('iframe#v') };
})()`;

async function evaluate(send, expression, contextId) {
  const params = { expression, awaitPromise: true, returnByValue: true };
  if (contextId) params.contextId = contextId;
  const r = await send('Runtime.evaluate', params);
  if (r.error) throw new Error('CDP error: ' + JSON.stringify(r.error));
  const rd = r.result;
  if (rd && rd.exceptionDetails) return { exception: rd.exceptionDetails.text + ' ' + JSON.stringify(rd.exceptionDetails.exception || {}) };
  return { value: rd && rd.result ? rd.result.value : undefined };
}

async function waitIsoContext(events) {
  for (let i = 0; i < 30; i++) {
    const ctxs = events.filter(e => e.method === 'Runtime.executionContextCreated').map(e => e.params.context);
    const iso = ctxs.find(c => c.auxData && c.auxData.type === 'isolated' && /^chrome-extension:/.test(c.origin || ''));
    if (iso) return iso;
    await sleep(500);
  }
  return null;
}

async function main() {
  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await jsonList(); if (targets.some(t => t.type === 'page')) break; } catch (e) {}
    await sleep(500);
  }
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('no page target found');

  const { ws, send, events } = await connect(page.webSocketDebuggerUrl);
  await send('Page.enable');
  await send('Runtime.enable');

  // 1) 答题页
  events.length = 0;
  await send('Page.navigate', { url: 'http://mooc1.chaoxing.com:8000/mock-chaoxing.html' });
  await sleep(2500);
  const iso1 = await waitIsoContext(events);
  let r1 = iso1 ? await evaluate(send, PANEL_EXPR, iso1.id) : { exception: 'no isolated world' };
  console.log('MOCK PAGE: ' + JSON.stringify(r1));
  const drag = iso1 ? await evaluate(send, DRAG_EXPR, iso1.id) : { exception: 'no isolated world' };
  console.log('DRAG: ' + JSON.stringify(drag));

  // 2) 视频课页面（非答题页）
  events.length = 0;
  await send('Page.navigate', { url: 'http://mooc1.chaoxing.com:8000/video-page.html' });
  await sleep(2500);
  const iso2 = await waitIsoContext(events);
  let r2 = iso2 ? await evaluate(send, PANEL_EXPR, iso2.id) : { exception: 'no isolated world' };
  console.log('VIDEO PAGE: ' + JSON.stringify(r2));

  // 3) 含 iframe 的父页面：顶层常驻 1 个；有题目的子框架 1 个；无题目的子框架 0 个
  events.length = 0;
  await send('Page.navigate', { url: 'http://mooc1.chaoxing.com:8000/frame-page.html' });
  await sleep(2500);
  const iso3 = await waitIsoContext(events);
  const r3 = iso3 ? await evaluate(send, FRAME_EXPR, iso3.id) : { exception: 'no isolated world' };
  console.log('FRAME PAGE: ' + JSON.stringify(r3));

  const v1 = r1.value || {}, v2 = r2.value || {}, vd = drag.value || {}, v3 = r3.value || {};
  let fail = false;
  const check = (name, cond, detail) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' -> ' + JSON.stringify(detail))); if (!cond) fail = true; };
  check('mock: panel mounted', v1.mounted === true, v1);
  check('mock: single panel instance', v1.hosts === 1, v1.hosts);
  check('mock: 8 questions', v1.count === 8, v1.count);
  check('mock: isAnswerPage', !!(v1.det && v1.det.isAnswerPage), v1.det);
  check('video: panel mounted', v2.mounted === true, v2);
  check('video: 0 questions', v2.count === 0, v2.count);
  check('video: not answer page', !!(v2.det && !v2.det.isAnswerPage), v2.det);
  check('video: status hint shown', typeof v2.status === 'string' && v2.status.indexOf('未识别到题目') === 0, v2.status);
  check('mock: drag clamped to viewport', vd.right <= vd.vw + 0.5 && vd.bottom <= vd.vh + 0.5 && vd.left >= -0.5 && vd.top >= -0.5, vd);
  check('frame: top frame 1 panel', v3.topHosts === 1, v3);
  check('frame: question iframe 1 panel', v3.qFrameHosts === 1, v3);
  check('frame: empty iframe 0 panels', v3.vFrameHosts === 0, v3);
  ws.close();
  if (fail) process.exit(1);
  console.log('PANEL ALL PASS');
}

main().catch((e) => { console.error('FAIL: ' + (e && e.message)); process.exit(1); });
