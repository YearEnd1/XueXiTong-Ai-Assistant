/* 学习通 AI 自动答题助手  答案回填
 * 选择题：点击可见选项行 + 兜底强制选中并派发事件；
 * 填空/简答：UEditor 富文本(iframe/UE API) -> contenteditable -> textarea/input。 */
(function (root) {
  'use strict';
  const CQ = (root.CQ = root.CQ || {});
  const U = CQ.util;
  const F = (CQ.filler = CQ.filler || {});
  F.lastResult = null;

  F.apply = function (questions, map, cfg) {
    const res = { applied: [], skipped: [], failed: [], total: questions.length };
    for (const q of questions) {
      const v = map.get(q.index);
      if (!v || !v.answer || !v.answer.length) {
        res.skipped.push({ index: q.index, type: q.type, reason: '模型未给出答案' });
        continue;
      }
      if (typeof v.confidence === 'number' && v.confidence < (cfg.minConfidence || 0)) {
        res.skipped.push({ index: q.index, type: q.type, answer: v.answer, reason: '置信度 ' + v.confidence.toFixed(2) + ' 低于阈值' });
        continue;
      }
      let ok = false;
      try { ok = fillQuestion(q, v.answer); } catch (e) { ok = false; }
      (ok ? res.applied : res.failed).push({
        index: q.index, type: q.type, answer: v.answer,
        confidence: v.confidence, reason: v.reason || ''
      });
    }
    F.lastResult = res;
    return res;
  };

  function fillQuestion(q, answer) {
    switch (q.type) {
      case 'single': case 'multiple': case 'judge': return fillChoice(q, answer);
      case 'fill': case 'short': return fillText(q, answer);
      default:
        if ((q.els.inputs || []).length) return fillChoice(q, answer);
        if ((q.els.texts || []).length) return fillText(q, answer);
        return false;
    }
  }

  /* ---------- 选择题 ---------- */
  function fillChoice(q, answer) {
    const keys = matchKeys(q, answer);
    if (!keys.size) return false;
    let ok = false;
    for (const key of keys) {
      const inp = inputForKey(q, key);
      if (inp && setChoice(inp)) ok = true;
      else {
        // 无 input 的自定义可点击选项：直接点击选项行元素
        const row = optionRowEl(q, key);
        if (row) { clickAt(row); ok = true; }
      }
    }
    return ok;
  }

  function matchKeys(q, answer) {
    const keys = new Set();
    const opts = q.options || [];
    const byKey = new Map(opts.map(o => [o.key, o]));

    if (q.type === 'judge') {
      const pos = new Set(['对', '正确', '是', 'T', 'TRUE', '\u221A', 'Y', 'YES']);
      const neg = new Set(['错', '错误', '否', 'F', 'FALSE', '\u00D7', 'X', 'N', 'NO']);
      const wants = (answer || []).map(a => String(a).trim().toUpperCase());
      const wantPos = wants.some(a => pos.has(a));
      const wantNeg = wants.some(a => neg.has(a));
      if (wantPos || wantNeg) {
        for (const o of opts) {
          const l = U.norm(o.label);
          const lUp = l.toUpperCase();
          const isPos = pos.has(lUp) || /^(对|正确|是|\u221A)/.test(l);
          const isNeg = neg.has(lUp) || /^(错|错误|否|\u00D7)/.test(l);
          if (wantPos && isPos) keys.add(o.key);
          if (wantNeg && isNeg) keys.add(o.key);
        }
        if (keys.size) return keys;
      }
    }

    for (const a of answer || []) {
      const s = String(a).trim();
      const up = s.toUpperCase();
      if (/^[A-H]$/.test(up) && byKey.has(up)) { keys.add(up); continue; }
      if (/^[A-Ha-h]{2,}$/.test(s)) { for (const c of s.toUpperCase()) if (byKey.has(c)) keys.add(c); continue; }
      // 按选项文字匹配
      const hit = opts.find(o => {
        const l = U.norm(o.label);
        return l === s || (s.length > 1 && (l.startsWith(s) || l.includes(s)));
      });
      if (hit) keys.add(hit.key);
    }
    return keys;
  }

  function inputForKey(q, key) {
    const inputs = q.els.inputs || [];
    for (const inp of inputs) if (String(inp.value || '').toUpperCase() === key) return inp;
    for (const inp of inputs) {
      const row = inp.closest('label,li,.option,tr,.mark_item') || inp.parentElement;
      const t = U.norm(row ? (row.innerText || row.textContent || '') : '');
      if (t && (t === key || t.startsWith(key + '、') || t.startsWith(key + '.') || t.startsWith(key + '．') ||
        t.startsWith(key + ',') || t.startsWith(key + '，') || t.startsWith(key + ':') || t.startsWith(key + '：'))) return inp;
    }
    const i = (q.options || []).findIndex(o => o.key === key);
    if (i >= 0 && inputs[i]) return inputs[i];
    return null;
  }

  /* 无 input 的自定义选项：在容器内按 key/文字找可点击行 */
  function optionRowEl(q, key) {
    if (!q.el || !q.el.querySelectorAll) return null;
    const opt = (q.options || []).find(o => o.key === key);
    const txt = opt ? U.norm(opt.label) : '';
    const cands = [];
    q.el.querySelectorAll('label,li,.option,.answerOption,tr,.mark_item,p,div').forEach(r => {
      if (r === q.el) return;
      if (r.getClientRects && r.getClientRects().length === 0) return;
      const t = U.norm(r.innerText || r.textContent || '').slice(0, 80);
      if (!t || t.length > 40) return;
      if (t === key || t === txt || t.startsWith(key + '、') || t.startsWith(key + '.') || t.startsWith(key + '．') ||
        t.startsWith(key + ',') || t.startsWith(key + '，') || t.startsWith(key + ':') || t.startsWith(key + '：')) { cands.push(r); return; }
      if (txt && t.includes(txt)) cands.push(r);
    });
    if (!cands.length) return null;
    cands.sort((a, b) => U.norm(a.innerText || '').length - U.norm(b.innerText || '').length);
    return cands[0];
  }

  function setChoice(inp) {
    if (!inp || inp.disabled) return false;
    // 学习通经常隐藏原生 input，用自定义行渲染：优先点击可见的行/标签
    let target = null;
    const label = inp.closest('label');
    const row = inp.closest('li,.option,.mark_item,tr') || inp.parentElement;
    const rowVisible = row && row.getClientRects().length > 0;
    if (rowVisible) target = row;
    else if (label && label.getClientRects().length > 0) target = label;
    else target = inp;
    clickAt(target);
    if (inp.checked) return true;
    if (target !== inp) { clickAt(inp); if (inp.checked) return true; }
    // 兜底：直接置位并派发事件
    try {
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'checked');
      if (desc && desc.set) desc.set.call(inp, true); else inp.checked = true;
    } catch (e) { inp.checked = true; }
    fire(inp, 'change');
    fire(inp, 'input');
    return !!inp.checked;
  }

  function clickAt(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true, cancelable: true, view: root,
      clientX: r.left + Math.min(Math.max(r.width / 2, 1), 8),
      clientY: r.top + Math.min(Math.max(r.height / 2, 1), 8)
    };
    try {
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    } catch (e) { /* ignore */ }
  }

  /* ---------- 填空 / 简答 ---------- */
  /* ---------- 学习通 dowork 作业/考试填空题结构 ---------- */
  // UEditor 是页面主世界对象：注入 <script> 事件桥，把 UE.setContent 送进页面上下文
  function ensureUeBridge() {
    try {
      if (root.document.getElementById('__cq_ue_bridge')) return;
      const s = root.document.createElement('script');
      s.id = '__cq_ue_bridge';
      s.textContent = 'function __cqUeFill(e) { try { if (e && e.__cqDone) return; if (e) e.__cqDone = true; document.documentElement.removeAttribute("data-cq-ue-ok"); var UE = window.UE; if (!UE || !UE.getEditor) return; var d = e.detail || {}; var name = d.name || d.id; var ed = UE.getEditor(name); if (!ed) return; ed.setContent(d.text || ""); var ta = document.getElementById(name) || (document.getElementsByName(name) || [])[0]; if (ta && (ta.tagName === "TEXTAREA" || ta.tagName === "INPUT")) { try { ta.value = d.text || ""; } catch (err2) {} } try { ed.fireEvent("contentChange"); } catch (err3) {} try { ed.fireEvent("contentchange"); } catch (err4) {} document.documentElement.setAttribute("data-cq-ue-ok", "1"); } catch (err) {} } window.addEventListener("__cq_set_ue", __cqUeFill); document.documentElement.addEventListener("__cq_set_ue", __cqUeFill);';
      (root.document.head || root.document.documentElement).appendChild(s);
      s.remove();
    } catch (e) { /* CSP 拦截时走 iframe 兜底 */ }
  }

  function pageSetUE(el, text) {
    try {
      ensureUeBridge();
      const name = el && el.getAttribute ? (el.getAttribute('name') || el.getAttribute('id') || '') : '';
      if (!name) return false;
      const host = root.document.documentElement;
      host.removeAttribute('data-cq-ue-ok');
      host.dispatchEvent(new root.CustomEvent('__cq_set_ue', { detail: { name, id: name, text }, bubbles: true }));
      return host.getAttribute('data-cq-ue-ok') === '1';
    } catch (e) { return false; }
  }

  function blankNo(li) {
    const fb = li && li.querySelector ? li.querySelector('.fb') : null;
    if (fb) {
      const m = String(fb.textContent || fb.innerText || '').match(/第\s*(\d+)\s*空/);
      if (m) return parseInt(m[1], 10);
    }
    return -1;
  }

  function setNativeValue(t, str) {
    try {
      const proto = t.tagName === 'TEXTAREA' ? root.HTMLTextAreaElement.prototype : root.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) desc.set.call(t, str); else t.value = str;
      return true;
    } catch (e) { try { t.value = str; return true; } catch (e2) { return false; } }
  }

  function fillText(q, answer) {
    let items = (answer || []).map(x => String(x).trim()).filter(x => x !== '');
    if (!items.length) return false;
    //  学习通 作业(.Zy_ulTk)/考试(.Cy_ulTk) 填空题：每个空位是 .XztiHover1（span.fb 标「第N空」，内含 input.inp 或 UEditor textarea）
    if (q.el && q.el.querySelectorAll) {
      const blanks = Array.from(q.el.querySelectorAll('.Zy_ulTk .XztiHover1, .Cy_ulTk .XztiHover1'))
        .map((el, i) => ({ el, i }))
        .sort((a, b) => {
          const na = blankNo(a.el), nb = blankNo(b.el);
          if (na < 0 && nb < 0) return a.i - b.i;
          if (na < 0) return 1;
          if (nb < 0) return -1;
          return (na - nb) || (a.i - b.i);
        })
        .map(x => x.el);
      if (blanks.length) {
        let ok = false;
        blanks.forEach((li, i) => {
          const v = items[i];
          if (v == null || v === '') return;
          const inp = li.querySelector ? (li.querySelector('input.inp') || li.querySelector('input[type=text], input:not([type])')) : null;
          if (inp && !inp.disabled) {
            if (setNativeValue(inp, v)) { fire(inp, 'input'); fire(inp, 'change'); ok = true; }
            return;
          }
          const ta = li.querySelector ? li.querySelector('textarea') : null;
          if (ta && !ta.disabled) {
            if (pageSetUE(ta, v)) { ok = true; return; }
            const fr = li.querySelector('iframe.edui-body-frame');
            if (fr) { if (fillTextEl(fr, v)) ok = true; return; }
            if (fillTextEl(ta, v)) ok = true;
          }
        });
        return ok;
      }
    }
    let texts = (q.els.texts || []).filter(usable);
    if (!texts.length && q.el) texts = Array.from(q.el.querySelectorAll('textarea,input[type=text],iframe.edui-body-frame,.edui-container,[contenteditable="true"]')).filter(usable);
    if (!texts.length) return false;
    // 去重：UEditor 空位的 .edui-container 与其内部 iframe 成对出现，只保留最外层控件
    texts = texts.filter(t => !texts.some(o => o !== t && o.contains && o.contains(t)));
    // 模型偶尔把多空答案拼进一个元素（用分号分隔）：拆开按空位分配
    if (items.length === 1 && items[0].includes('；')) items = items[0].split(/[；;]/).map(x => x.trim()).filter(Boolean);
    // 提取到的控件少于答案数：在题目容器内加宽搜索文本类控件
    if (texts.length < items.length && q.el && q.el.querySelectorAll) {
      const extra = Array.from(q.el.querySelectorAll('input,textarea,[contenteditable="true"]')).filter(el => {
        if (texts.includes(el)) return false;
        const tag = el.tagName;
        if (tag === 'TEXTAREA') return !el.disabled;
        if (tag === 'INPUT') return ['text', ''].includes((el.type || '').toLowerCase()) && !el.disabled;
        return true;
      });
      for (const el of extra) if (texts.length < items.length) texts.push(el);
      texts = texts.filter(t => !texts.some(o => o !== t && o.contains && o.contains(t)));
    }
    let ok = false;
    // 一一对应：第 i 个空位填第 i 个答案；答案不足的空位留空（不再把末位答案复制到所有空）
    texts.forEach((t, i) => {
      const v = items[i] != null && items[i] !== '' ? items[i] : '';
      if (!v) return;
      if (fillTextEl(t, v)) ok = true;
    });
    return ok;
  }

  function usable(t) {
    return !!t && t.isConnected;
  }

  function fillTextEl(t, v) {
    const str = String(v == null ? '' : v);
    // 0) UEditor 容器
    if (t.classList && t.classList.contains('edui-container')) {
      const fr = t.querySelector('iframe.edui-body-frame');
      if (fr) return fillTextEl(fr, str);
      const ta = t.querySelector('textarea');
      if (ta) return fillTextEl(ta, str);
    }
    // 1) UEditor iframe
    if (t.tagName === 'IFRAME' && (/edui/i.test(t.className || '') || /^ueditor/i.test(t.id || '') || /edui/i.test((t.parentElement && t.parentElement.className) || ''))) {
      try {
        const doc = t.contentDocument;
        if (doc && doc.body) {
          doc.body.textContent = str;
          fire(doc.body, 'input');
          return true;
        }
      } catch (e) { /* 跨域 */ }
    }
    // 2) UEditor API
    const edId = (t.id || (t.getAttribute && (t.getAttribute('name') || ''))) || '';
    if (edId) {
      try {
        const UE = (root.UE || (root.window && root.window.UE)) || null;
        if (UE && UE.getEditor) {
          const ed = UE.getEditor(edId);
          if (ed) { ed.setContent(str); return true; }
        }
      } catch (e) { /* ignore */ }
    }
    // 2b) 页面主世界 UE 桥（isolated world 拿不到页面 UE 对象）
    if (pageSetUE(t, str)) return true;
    // 3) contenteditable
    if (t.isContentEditable || (t.getAttribute && t.getAttribute('contenteditable') === 'true')) {
      t.textContent = str;
      fire(t, 'input');
      return true;
    }
    // 4) textarea / input
    if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') {
      if (setNativeValue(t, str)) {
        fire(t, 'input');
        fire(t, 'change');
        return true;
      }
    }
    return false;
  }

  /* 清空已填答案 */
  F.clear = function (questions) {
    for (const q of questions || []) {
      ((q.els && q.els.inputs) || []).forEach(i => {
        if (i.checked) {
          try { i.checked = false; } catch (e) { /* ignore */ }
          fire(i, 'change');
        }
      });
      ((q.els && q.els.texts) || []).forEach(t => {
        try {
          if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') {
            const desc = Object.getOwnPropertyDescriptor(
              t.tagName === 'TEXTAREA' ? root.HTMLTextAreaElement.prototype : root.HTMLInputElement.prototype, 'value');
            if (desc && desc.set) desc.set.call(t, ''); else t.value = '';
            fire(t, 'input');
          } else if (t.isContentEditable || (t.getAttribute && t.getAttribute('contenteditable') === 'true')) {
            t.textContent = '';
            fire(t, 'input');
          }
        } catch (e) { /* ignore */ }
      });
    }
  };

  function fire(el, type) {
    if (!el || !el.dispatchEvent) return;
    const ev = (type === 'input' || type === 'change' || type === 'keyup' || type === 'blur')
      ? new Event(type, { bubbles: true })
      : new MouseEvent(type, { bubbles: true, cancelable: true, view: root });
    try { el.dispatchEvent(ev); } catch (e) { /* ignore */ }
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);