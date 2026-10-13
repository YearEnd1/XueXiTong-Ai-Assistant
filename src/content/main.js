/* 学习通 AI 自动答题助手  页面主流程
 * 识别 -> 上报后台 -> (自动/手动)AI 答题 -> 预览/回填 -> (可选)交卷 */
(function (root) {
  'use strict';
  if (root.__cqAiAnswerMain) return;
  root.__cqAiAnswerMain = true;

  const CQ = root.CQ;
  const U = CQ.util;
  const state = {
    cfg: null, scan: null, det: null, map: new Map(),
    answering: false, autoSig: null, panelMounted: false
  };

  const isTop = root.top === root; // 仅顶层窗口常驻悬浮窗

  // toast 只在挂载了面板的窗口显示（顶层，或识别到题目的子框架）
  function toast(text, tone) { if (state.panelMounted) CQ.panel.toast(text, tone); }

  boot();

  async function boot() {
    try {
      if (!document.body) return; // about:blank 子框架等
      state.cfg = await CQ.store.get();
      let det = { isAnswerPage: false, kind: '未知页面' };
      try { det = CQ.extractor.detectPage(document); } catch (e) { /* 识别异常也保留面板 */ }
      state.det = det;
      let scan = null;
      try { scan = CQ.extractor.scan(document); } catch (e) { scan = { questions: [], kind: '识别异常' }; }
      state.scan = scan;
      // 悬浮窗：顶层窗口常驻；子框架仅识别到题目时挂载（避免每个 iframe 都弹面板）
      if (isTop || scan.questions.length) {
        state.panelMounted = true;
        CQ.panel.mount({ cfg: state.cfg });
        bindPanel();
        updateUi();
      }
      report(det, state.scan);

      const mo = new MutationObserver(U.debounce(() => rescan(), 1200));
      mo.observe(document.documentElement, { childList: true, subtree: true });

      if (state.cfg.autoAnswer && state.scan.questions.length) {
        state.autoSig = sigOf(state.scan.questions);
        setTimeout(() => answerFlow(), 800);
      }
      chrome.runtime.onMessage.addListener(onMessage);
    } catch (e) {
      try { toast('初始化失败：' + e.message, 'err'); } catch (e2) { /* ignore */ }
    }
  }

  function sigOf(qs) { return qs.map(q => q.stem.slice(0, 80)).join('|'); }

  async function rescan() {
    let det = { isAnswerPage: false, kind: '未知页面' };
    try { det = CQ.extractor.detectPage(document); } catch (e) { /* ignore */ }
    const scan = CQ.extractor.scan(document);
    const prev = state.scan ? state.scan.questions.length : -1;
    state.scan = scan;
    state.det = det;
    if (scan.questions.length !== prev) {
      updateUi();
      report(det, scan);
      const sig = sigOf(scan.questions);
      if (state.cfg.autoAnswer && scan.questions.length && sig !== state.autoSig) {
        state.autoSig = sig;
        answerFlow();
      }
    }
  }

  function updateUi() {
    const qs = state.scan ? state.scan.questions : [];
    if (!qs.length) {
      CQ.panel.setStatus('未识别到题目，点击识别重试', '');
      CQ.panel.setStats(state.det && state.det.isAnswerPage
        ? '已识别为答题页但未提取到题目，点「识别」重试'
        : '当前页面未识别为答题页（视频/资料页无题目属正常）。如在答题页，点「识别」重试');
      CQ.panel.setFoot('模型：' + (state.cfg.model || '未配置'));
      return;
    }
    const byType = {};
    qs.forEach(q => { byType[q.type] = (byType[q.type] || 0) + 1; });
    const desc = Object.keys(byType).map(t => CQ.TYPE_LABELS[t] + '  ' + byType[t]).join('  ');
    CQ.panel.setStats(`已识别 ${qs.length} 题（${state.scan.kind || ''}）：${desc}`);
    CQ.panel.setStatus('已就绪，点击AI 答题开始', 'ok');
    CQ.panel.setFoot('模型：' + (state.cfg.model || '未配置') + (state.cfg.enableCache ? '  缓存开' : '  缓存关'));
  }

  function bindPanel() {
    CQ.panel.on('rescan', () => { rescan(); toast('已重新识别'); });
    CQ.panel.on('answer', () => answerFlow());
    CQ.panel.on('apply', () => {
      if (!state.map.size) { toast('还没有答案，请先AI 答题', 'err'); return; }
      applyFlow();
    });
    CQ.panel.on('clear', () => {
      CQ.filler.clear(state.scan ? state.scan.questions : []);
      state.map = new Map();
      CQ.panel.showResults(null);
      CQ.panel.setStatus('已清空答案，点击AI 答题重新生成', '');
      toast('已清空');
    });
    CQ.panel.on('submit', () => submitFlow());
  }

  /* ---------- AI 答题 ---------- */
  async function answerFlow() {
    if (state.answering) return;
    state.cfg = await CQ.store.get();
    const scan = CQ.extractor.scan(document);
    state.scan = scan;
    const qs = scan.questions;
    if (!qs.length) {
      CQ.panel.setStatus('未识别到题目', 'err');
      toast('未识别到题目，请确认处于答题页', 'err');
      return;
    }
    if (!state.cfg.apiKey && !/authorization/i.test(state.cfg.extraHeaders || '')) {
      CQ.panel.setStatus('未配置 API Key', 'err');
      toast('请先在设置中填写 API Key', 'err');
      CQ.runtime = (typeof chrome !== 'undefined' && chrome.runtime) || null;
      if (chrome.runtime && chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
      return;
    }
    state.answering = true;
    state.map = new Map();
    CQ.panel.setBusy(true);
    const payload = qs.map(q => CQ.extractor.serialize(q));
    const batches = U.chunk(payload, state.cfg.batchSize);
    CQ.panel.setStatus(`正在请求模型（${payload.length} 题，${batches.length} 轮）`, 'busy');
    let failRounds = 0, verifyTot = null;
    for (let i = 0; i < batches.length; i++) {
      if (i > 0) {
        CQ.panel.setStatus(`模型作答中 ${i}/${batches.length} `, 'busy');
        await U.sleep(state.cfg.requestDelayMs);
      }
      try {
        const r = await U.safeSend({ type: CQ.MSG.ANSWER, questions: batches[i] });
        if (!r || !r.ok) {
          failRounds++;
          toast(`第 ${i + 1} 轮失败：${(r && r.error) || '未知错误'}`, 'err');
        } else if (r.map) {
          for (const [k, v] of Object.entries(r.map)) state.map.set(Number(k), v);
        }
        if (r.verify) {
          verifyTot = verifyTot || { consistent: 0, rewritten: 0, failed: 0 };
          verifyTot.consistent += r.verify.consistent || 0;
          verifyTot.rewritten += r.verify.rewritten || 0;
          verifyTot.failed += r.verify.failed || 0;
        }
      } catch (e) {
        failRounds++;
        toast(`第 ${i + 1} 轮异常：${(e && e.message) || e}`, 'err');
      }
    }
    state.answering = false;
    CQ.panel.setBusy(false);

    const got = state.map.size;
    if (!got) {
      CQ.panel.setStatus('没有拿到任何答案，请检查 API 配置与网络', 'err');
      report(null, state.scan, false);
      return;
    }
    const missing = qs.filter(q => !state.map.has(q.index)).length;

    if (state.cfg.previewFirst) {
      const res = buildPreview(qs);
      CQ.panel.showResults(res, state.map);
      CQ.panel.setStatus(`已生成 ${got}/${qs.length} 题答案，核对后点应用填写`, 'ok');
      const vTxt = verifyTot ? `  检测 一致${verifyTot.consistent} 重答${verifyTot.rewritten}${verifyTot.failed ? ' 失败' + verifyTot.failed : ''}` : '';
      CQ.panel.setFoot(`模型 ${state.cfg.model}  未生成 ${missing} 题  失败 ${failRounds} 轮${vTxt}`);
      toast(`已生成 ${got}/${qs.length} 题答案`);
    } else {
      applyFlow();
    }
    report(null, state.scan, true);
  }

  function buildPreview(qs) {
    const pending = [], skipped = [], failed = [];
    for (const q of qs) {
      const v = state.map.get(q.index);
      if (!v || !v.answer || !v.answer.length) {
        skipped.push({ index: q.index, type: q.type, reason2: '模型未给出答案' });
      } else if (typeof v.confidence === 'number' && v.confidence < (state.cfg.minConfidence || 0)) {
        skipped.push({ index: q.index, type: q.type, answer: v.answer, confidence: v.confidence, reason: v.reason, reason2: '置信度低于阈值' });
      } else {
        pending.push({ index: q.index, type: q.type, answer: v.answer, confidence: v.confidence, reason: v.reason, reason2: v.reason2 });
      }
    }
    return { pending, skipped, failed, total: qs.length };
  }

  /* ---------- 回填 / 交卷 ---------- */
  function applyFlow() {
    const qs = state.scan.questions;
    const res = CQ.filler.apply(qs, state.map, state.cfg);
    CQ.panel.showResults(res, state.map);
    const n = res.applied.length;
    const parts = [`已填写 ${n} 题`];
    if (res.skipped.length) parts.push(`跳过 ${res.skipped.length}`);
    if (res.failed.length) parts.push(`失败 ${res.failed.length}`);
    CQ.panel.setStatus(parts.join('，'), n ? 'ok' : 'err');
    toast(parts.join('，'));
    report(null, state.scan, true);
    if (state.cfg.autoSubmit) setTimeout(() => submitFlow(true), 600);
  }

  function submitFlow(silent) {
    const btn = findSubmitButton();
    if (!btn) {
      toast('未找到提交按钮，请手动交卷', 'err');
      return;
    }
    const doSubmit = () => {
      const r = btn.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, view: root, clientX: r.left + 4, clientY: r.top + 4 };
      try {
        btn.dispatchEvent(new MouseEvent('click', opts));
        if (typeof btn.click === 'function' && btn.tagName !== 'A') btn.click();
      } catch (e) { /* ignore */ }
      toast('已点击交卷按钮，请留意页面确认弹窗');
      if (state.cfg.autoNext) nextChapterFlow();
    };
    if (silent || window.confirm('确定要提交试卷吗？提交后一般无法修改。')) doSubmit();
  }

  function findSubmitButton() {
    const cands = document.querySelectorAll('a,button,input[type=submit],input[type=button],div[class*=btn i],span[class*=btn i],div[class*=Btn i],a[class*=Btn i]');
    for (const el of Array.from(cands)) {
      const t = U.norm(el.innerText || el.value || '');
      if (!t) continue;
      if (/^(立即交卷|确定交卷|确认交卷|提交试卷|交卷|确认提交|提交并查看结果)$/.test(t)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
      }
      const oc = String(el.getAttribute('onclick') || '');
      if (/submit|交卷|saveExam|handin/i.test(oc)) return el;
    }
    return null;
  }

  /* ---------- 交卷后自动跳转下一章节 ---------- */
  function nextChapterFlow() {
    const attempts = [2500, 4000, 6000, 8500];
    let done = false;
    for (let i = 0; i < attempts.length; i++) {
      setTimeout(() => {
        if (done) return;
        const el = findNextChapterBtn();
        if (!el) {
          if (i === attempts.length - 1) toast('自动跳转：未找到下一章节入口，请手动跳转', '');
          return;
        }
        done = true;
        const r = el.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, view: root, clientX: r.left + 4, clientY: r.top + 4 };
        try {
          el.dispatchEvent(new MouseEvent('click', opts));
          if (typeof el.click === 'function' && el.tagName !== 'A') el.click();
        } catch (e) { /* ignore */ }
        toast('已点击下一章节入口，正在跳转', 'ok');
      }, attempts[i]);
    }
  }

  function findNextChapterBtn() {
    const cands = document.querySelectorAll('a,button,div[class*=btn i],span[class*=btn i],[class*=next i],[class*=catalog i],.jb_btn');
    for (const el of Array.from(cands)) {
      const t = U.norm(el.innerText || el.value || el.getAttribute('title') || '');
      if (!t || t.length > 14) continue;
      if (/^(下一章节|下一章|下一节|下一课|下一任务|继续下一节|继续学习|next)$/.test(t)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
      }
    }
    return null;
  }

  /* ---------- 上报后台 ---------- */
  function report(det, scan, answered) {
    try {
      const d = det || CQ.extractor.detectPage(document);
      const qs = scan ? scan.questions : [];
      U.safeSend({
        type: CQ.MSG.REPORT,
        kind: d.kind, count: qs.length,
        hasApiKey: !!(state.cfg && state.cfg.apiKey),
        answered: !!answered
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }

  function onMessage(msg, sender, sendResponse) {
    if (!msg || msg.type !== CQ.MSG.PAGE_CMD) return;
    (async () => {
      let r = { ok: true };
      switch (msg.cmd) {
        case 'rescan': rescan(); break;
        case 'answer': await answerFlow(); break;
        case 'apply':
          if (!state.map.size) r = { ok: false, error: '还没有答案' };
          else applyFlow();
          break;
        case 'clear':
          CQ.filler.clear(state.scan ? state.scan.questions : []);
          state.map = new Map();
          CQ.panel.showResults(null);
          break;
        case 'submit': submitFlow(); break;
        case 'status':
          r = { ok: true, det: CQ.extractor.detectPage(document) };
          break;
        default: r = { ok: false, error: 'unknown cmd' };
      }
      sendResponse(r);
    })();
    return true;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);