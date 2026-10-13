// test/cdp-check.mjs  CDP smoke: load real extension code in headless Edge and exercise extractor+filler
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

const TEST_EXPR = `(async () => {
  const out = { err: null };
  try {
    const det = CQ.extractor.detectPage(document);
    out.det = { isAnswerPage: det.isAnswerPage, kind: det.kind, count: det.count };
    const scan = CQ.extractor.scan(document);
    out.questions = scan.questions.map(q => ({
      index: q.index, type: q.type, stem: (q.stem || '').slice(0, 30),
      options: (q.options || []).map(o => o.key + ':' + (o.label || '').slice(0, 8)),
      nInputs: (q.els.inputs || []).length, nTexts: (q.els.texts || []).length
    }));
    const map = new Map([
      [1, { answer: ['B'], confidence: 0.9 }],
      [2, { answer: ['A', 'D'], confidence: 0.9 }],
      [3, { answer: ['\\u5BF9'], confidence: 0.9 }],
      [4, { answer: ['10', '1'], confidence: 0.9 }],
      [5, { answer: ['tls + cert'], confidence: 0.9 }],
      [6, { answer: ['A'], confidence: 0.9 }],
      [7, { answer: ['\\u6B63\\u786E'], confidence: 0.9 }],
      [8, { answer: ['WWW'], confidence: 0.9 }]
    ]);
    const res = CQ.filler.apply(scan.questions, map, { minConfidence: 0 });
    out.result = {
      applied: res.applied.map(x => x.index),
      skipped: res.skipped.map(x => x.index + ':' + x.reason),
      failed: res.failed.map(x => x.index + ':' + (x.reason || ''))
    };
    out.after = {};
    for (const q of scan.questions) {
      const checked = (q.els.inputs || []).filter(i => i.checked).map(i => i.value);
      const texts = (q.els.texts || []).map(t => String(t.value !== undefined ? t.value : (t.textContent || '')).slice(0, 40));
      out.after[q.index] = { type: q.type, checked, texts };
    }
  } catch (e) { out.err = (e && e.message) + ' | ' + (e && e.stack); }
  return out;
})()`;

const INJECT = ['src/common/constants.js', 'src/common/util.js', 'src/common/store.js', 'src/content/extractor.js', 'src/content/filler.js'];

async function evaluate(send, expression, contextId) {
  const params = { expression, awaitPromise: true, returnByValue: true };
  if (contextId) params.contextId = contextId;
  const r = await send('Runtime.evaluate', params);
  if (r.error) throw new Error('CDP error: ' + JSON.stringify(r.error));
  const rd = r.result;
  if (rd && rd.exceptionDetails) return { exception: rd.exceptionDetails.text + ' ' + JSON.stringify(rd.exceptionDetails.exception || {}) };
  return { value: rd && rd.result ? rd.result.value : undefined };
}

async function main() {
  let targets;
  for (let i = 0; i < 60; i++) {
    try {
      targets = await jsonList();
      if (targets.some(t => t.type === 'page')) break;
    } catch (e) { /* retry */ }
    await sleep(500);
  }
  const page = targets.find(t => t.type === 'page');
  if (!page) throw new Error('no page target found');
  console.log('page:', page.url);

  const { ws, send, events } = await connect(page.webSocketDebuggerUrl);
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://mooc1.chaoxing.com:8000/mock-chaoxing.html' });
  await sleep(2500);
  await send('Runtime.enable');
  await sleep(800);
  const ctxs = events.filter(e => e.method === 'Runtime.executionContextCreated').map(e => e.params.context);
  const iso = ctxs.find(c => c.auxData && c.auxData.type === 'isolated' && /^chrome-extension:/.test(c.origin || ''));

  let out;
  if (iso) {
    console.log('using extension isolated world:', iso.origin, 'ctx', iso.id);
    const r = await evaluate(send, TEST_EXPR, iso.id);
    out = { mode: 'extension-isolated-world', ...r };
  } else {
    console.log('no extension isolated world (extension may not load in headless) -> inject scripts into main world');
    const stub = `globalThis.chrome = globalThis.chrome || { runtime: { onMessage: { addListener(){} } }, storage: { local: { get: (k, cb) => cb && cb({}), set: (k, v, cb) => cb && cb() } } };`;
    await evaluate(send, stub);
    for (const f of INJECT) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const r = await evaluate(send, src);
      if (r.exception) throw new Error('inject failed ' + f + ': ' + r.exception);
    }
    const r = await evaluate(send, TEST_EXPR);
    out = { mode: 'main-world-inject', ...r };
  }
  console.log(JSON.stringify(out, null, 2));
  ws.close();
}

main().catch((e) => { console.error('FAIL: ' + (e && e.message)); process.exit(1); });