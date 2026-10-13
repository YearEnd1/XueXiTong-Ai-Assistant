// test/cdp-detection.mjs  识别回归：验证视频课误报过滤 + 弱结构答题页仍能识别
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
  const mk = (html, cls) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; document.body.appendChild(d); return d; };
  try {
    // 0) 真实 mock 答题页回归：应为 8 题
    const live = CQ.extractor.scan(document);
    out.live = live.questions.length;

    // 1) 视频课页面仿真：课程介绍/常见问题/评论框/笔记框/清晰度单选组 -> 应为 0 题
    const vHtml = '<div class="subject">2024、春季学期课程介绍：本课程主要内容包括数据结构与算法基础，请同学们认真学习第一章。</div>' +
      '<div id="questionList"><div>常见问题</div><div>Q1：怎么签到？</div><div>A：点击签到按钮即可</div></div>' +
      '<div id="commentBox"><span>发表评论</span><textarea placeholder="请输入评论内容"></textarea></div>' +
      '<div id="noteBox"><span>添加笔记</span><textarea placeholder="请输入笔记内容"></textarea></div>' +
      '<div class="filter"><span>播放清晰度</span>' +
      '<label><input type="radio" name="quality" value="ld">A、流畅</label>' +
      '<label><input type="radio" name="quality" value="sd">B、高清</label>' +
      '<label><input type="radio" name="quality" value="hd">C、原画</label></div>';
    const v = mk(vHtml, 'videoSim');
    out.video = CQ.extractor.scan(v).questions.map(q => ({ t: q.type, s: (q.stem || '').slice(0, 30) }));

    // 2) 弱结构容器但确为填空题（题号+空位）-> 应为 1 题 fill
    const w = mk('<div class="questionContent">3、以下说法正确的是（ ）。<textarea></textarea></div>', 'weakSim');
    out.weakFill = CQ.extractor.scan(w).questions.map(q => ({ t: q.type, s: (q.stem || '').slice(0, 30) }));

    // 3) 强特征容器（无题型标注的简答）-> 应保留 1 题
    const st = mk('<div class="TiMu">请简述你的观点。<textarea></textarea></div>', 'strongSim');
    out.strong = CQ.extractor.scan(st).questions.map(q => ({ t: q.type, s: (q.stem || '').slice(0, 30) }));

    // 4) 通用容器 + 选择题控件组 -> 应识别 1 题 single
    const ch = mk('<div class="plainBox"><span>2、以下哪个是操作系统？</span>' +
      '<label><input type="radio" name="q1" value="A">A、Windows</label>' +
      '<label><input type="radio" name="q1" value="B">B、Chrome</label>' +
      '<label><input type="radio" name="q1" value="C">C、Word</label>' +
      '<label><input type="radio" name="q1" value="D">D、Edge</label></div>', 'choiceSim');
    out.choice = CQ.extractor.scan(ch).questions.map(q => ({ t: q.type, n: q.options.length }));

    // 5) 用户实机格式：题号+括号题型「1（判断题）」无分隔符；自定义可点击选项（div 行、无 input）-> 应识别 2 题 judge+single
    const jg = mk('<div class="paperArea">' +
      '<p>一、判断题（共3题）</p>' +
      '<div class="queWrap"><span>1（判断题）国家安全与国家生存发展始终相伴相随，是任何时代、任何形态的国家主体都高度重视的重大战略问题。</span>' +
      '<div class="optRow">A对</div><div class="optRow">B错</div></div>' +
      '<div class="queWrap"><span>4（单选题）习近平在十八届中央国家安全委员会第一次会议上创造性提出总体国家安全观的概念并阐述其科学内涵。</span>' +
      '<div class="optCell">A</div><div class="optCell">2013年4月15日</div>' +
      '<div class="optCell">B</div><div class="optCell">2014年4月15日</div>' +
      '<div class="optCell">C</div><div class="optCell">2015年4月15日</div></div>' +
      '</div>', 'paperSim');
    out.paper = CQ.extractor.scan(jg).questions.map(q => ({ t: q.type, s: (q.stem || '').slice(0, 20), n: q.options.length }));

    // 6) 同一格式但带 radio input（真实学习通常见结构）-> 控件组兜底应识别 1 题 single
    const pr = mk('<div class="xBox"><span>4（单选题）习近平在十八届中央国家安全委员会第一次会议上创造性提出总体国家安全观的概念。</span>' +
      '<label><input type="radio" name="p4" value="2013">A、2013年4月15日</label>' +
      '<label><input type="radio" name="p4" value="2014">B、2014年4月15日</label>' +
      '<label><input type="radio" name="p4" value="2015">C、2015年4月15日</label></div>', 'paperRadioSim');
    out.paperRadio = CQ.extractor.scan(pr).questions.map(q => ({ t: q.type, s: (q.stem || '').slice(0, 20), n: q.options.length }));

    [v, w, st, ch, jg, pr].forEach(d => d.remove());
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
    console.log('using extension isolated world ctx', iso.id);
    const r = await evaluate(send, TEST_EXPR, iso.id);
    out = { mode: 'extension-isolated-world', ...r };
  } else {
    console.log('no extension isolated world -> inject into main world');
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

  const v = out.value || out;
  let fail = false;
  const check = (name, cond, detail) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : ' -> ' + JSON.stringify(detail))); if (!cond) fail = true; };
  if (out.exception) { console.error('EVAL EXCEPTION: ' + out.exception); process.exit(1); }
  check('mock live page = 8 questions', v.live === 8, v.live);
  check('video page sim = 0 questions', Array.isArray(v.video) && v.video.length === 0, v.video);
  check('weak fill question detected = 1', Array.isArray(v.weakFill) && v.weakFill.length === 1 && v.weakFill[0].t === 'fill', v.weakFill);
  check('strong container kept = 1', Array.isArray(v.strong) && v.strong.length === 1, v.strong);
  check('weak choice question detected = 1 single', Array.isArray(v.choice) && v.choice.length === 1 && v.choice[0].t === 'single', v.choice);
  check('paper judge+single via signal fallback = 2', Array.isArray(v.paper) && v.paper.length === 2 && v.paper[0].t === 'judge' && v.paper[0].n === 2 && v.paper[1].t === 'single' && v.paper[1].n === 3, v.paper);
  check('paper radio via input groups = 1 single', Array.isArray(v.paperRadio) && v.paperRadio.length === 1 && v.paperRadio[0].t === 'single' && v.paperRadio[0].n === 3, v.paperRadio);
  ws.close();
  if (fail) process.exit(1);
  console.log('DETECTION ALL PASS');
}

main().catch((e) => { console.error('FAIL: ' + (e && e.message)); process.exit(1); });
