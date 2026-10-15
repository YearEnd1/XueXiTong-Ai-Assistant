/* 学习通 AI 自动答题助手  题目识别与抽取
 * 兼容超星作业(doHomeWorkNew / mooc2/dowork)、考试(reVersionTestStartNew)、
 * 章节测验、作业预览等页面结构；多策略 + 通用兜底。 */
(function (root) {
  'use strict';
  const CQ = (root.CQ = root.CQ || {});
  const U = CQ.util;
  const E = (CQ.extractor = CQ.extractor || {});

  const CHOICE_INPUT = 'input[type=radio],input[type=checkbox]';
  const TEXT_CTRL = 'textarea,input[type=text],input:not([type]),iframe.edui-body-frame,[contenteditable="true"],.edui-container';

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const st = root.getComputedStyle ? root.getComputedStyle(el) : null;
    if (st && (st.display === 'none' || st.visibility === 'hidden')) return false;
    return r.width >= 0 && r.height >= 0;
  }

  /* ---------- 页面识别 ---------- */
  function ancestorOrigin() {
    try {
      if (location.ancestorOrigins && location.ancestorOrigins.length) return location.ancestorOrigins[0];
    } catch (e) { /* ignore */ }
    return '';
  }

  function pageKind() {
    const u = location.href || '';
    for (const r of CQ.URL_RULES) if (r.re.test(u)) return r.page;
    return '学习通答题页';
  }

  E.detectPage = function (rootEl) {
    const r = E.scan(rootEl || document);
    const u = location.href || '';
    const urlHit = CQ.URL_RULES.some(x => x.re.test(u));
    const domHit = r.questions.length >= 1 &&
      (r.questions.some(q => (q.els.inputs || []).length) || r.questions.some(q => q.type !== 'unknown'));
    const host = location.hostname || (function () { try { return new URL(ancestorOrigin()).hostname; } catch (e) { return ''; } })();
    return {
      isAnswerPage: !!(urlHit || domHit),
      hostHit: CQ.HOST_RE.test(host),
      urlHit, domHit,
      kind: urlHit ? pageKind() : (domHit ? '学习通答题页' : ''),
      count: r.questions.length
    };
  };

  /* ---------- 主扫描 ---------- */
  E.scan = function (rootEl) {
    const d = rootEl || document;
    if (!d.querySelectorAll) return { kind: pageKind(), questions: [] };
    const questions = [];
    const covered = new Set();
    const foundEls = new Set();

    const containers = pickContainers(d);
    for (const c of containers) {
      const q = extractContainer(c.el, d, c.strong);
      if (q) {
        questions.push(q);
        foundEls.add(q.el);
        q.els.inputs.forEach(i => covered.add(i));
        q.els.texts.forEach(t => covered.add(t));
      }
    }

    if (!questions.length) {
      const gq = extractByInputGroups(d);
      for (const q of gq) {
        questions.push(q);
        foundEls.add(q.el);
        q.els.inputs.forEach(i => covered.add(i));
        q.els.texts.forEach(t => covered.add(t));
      }
    }

    orphanTexts(d, covered, questions, foundEls);

    // 终极兜底：按题目信号 + 选项行扫描任意容器（无 input 的自定义点击选项页）
    for (const q of extractBySignals(d, covered, foundEls)) {
      questions.push(q);
      foundEls.add(q.el);
      q.els.inputs.forEach(i => covered.add(i));
      q.els.texts.forEach(t => covered.add(t));
    }

    // 题目顺序按 DOM 出现顺序排序并重编号
    questions.sort((a, b) => compareDocOrder(a.el || a.anchor, b.el || b.anchor));
    questions.forEach((q, i) => {
      q.index = i + 1;
      if (!q.qid) q.qid = 'q' + (i + 1);
    });
    return { kind: pageKind(), questions };
  };

  function compareDocOrder(a, b) {
    if (a === b) return 0;
    if (!a || !a.isConnected) return 1;
    if (!b || !b.isConnected) return -1;
    try {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    } catch (e) { /* ignore */ }
    return 0;
  }

  function pickContainers(d) {
    const found = [];
    const seen = new Set();
    const strongSel = new Set(CQ.STRONG_CONTAINER_SELECTORS || []);
    for (const sel of CQ.CONTAINER_SELECTORS) {
      try {
        d.querySelectorAll(sel).forEach(el => {
          if (!seen.has(el)) { seen.add(el); found.push({ el, strong: strongSel.has(sel) }); } // same element matching several selectors is collected once
        });
      } catch (e) { /* 非法选择器 */ }
    }
    if (!found.length) return [];
    return found.filter(x => {
      const el = x.el;
      if (!el.isConnected) return false;
      if (found.some(o => o !== x && o.el.contains(el))) return false; // 只留最外层
      const text = U.norm(el.innerText || el.textContent || '');
      if (text.length < 4) return false;
      const hasCtrl = !!el.querySelector(CHOICE_INPUT + ',' + TEXT_CTRL);
      return hasCtrl || text.length >= 12;
    });
  }

  /* 题目特征信号：题号 / 题型标注 / 分值 / 空位 / 问号结尾 / 答案提示
   * 用于把视频课、讨论区里的评论框/提问框从填空题误报里过滤掉。 */
  function questionSignals(text) {
    const t = String(text || '');
    return /[(（【〔][^)）】〕]{0,14}(单选|多选|不定项|判断|填空|简答|问答|论述|名词解释|计算|分析|综合|选择\s*题)[^)）】〕]{0,14}[)）】〕]/.test(t) ||
      /[（(]\s*\d+(\.\d+)?\s*分\s*[)）]/.test(t) ||
      /(^|[\s>【（(〔第])\s*(\d{1,3}|[一二三四五六七八九十]{1,3})\s*[、.．)）（【〕](?![0-9])/.test(t) ||
      /第\s*(\d{1,3}|[一二三四五六七八九十]{1,3})\s*题/.test(t) ||
      /_{2,}|[（(]\s*[)）]/.test(t) ||
      /[？?]\s*$/.test(t.trim()) ||
      /(答案|填空)\s*[:：]/.test(t);
  }

  /* ---------- 单个容器抽取 ---------- */
  function extractContainer(el, d, strong, includeDivs) {
    const text = U.norm(el.innerText || el.textContent || '');
    if (text.length < 4) return null;

    const optionRows = collectOptionRows(el, includeDivs);
    const options = optionRows.map((row, i) => parseOption(row, i)).filter(Boolean);

    const inputs = Array.from(el.querySelectorAll(CHOICE_INPUT)); // 学习通常用隐藏 input + 自定义渲染，不能按可见性过滤
    const texts = Array.from(el.querySelectorAll(TEXT_CTRL));

    const stem = cleanStem(deriveStem(el, optionRows));
    if (!stem || stem.length < 2) return null;

    const head = text.slice(0, 90);
    let type = detectType(el, options, head, stem, texts.length);
    const blanks = countBlanks(el, stem, texts);

    const images = collectImages(el);

    /* 题目可信度校验：过滤视频课/讨论区里被误判为填空题的评论框、提问框等
     * - 有选择题控件（>=2 个选项且带 input） 一定是选择题
     * - 强特征容器（.TiMu/.questionLi 等学习通题目专属结构） 直接采信
     * - 其余容器若带文本框，必须同时具备题目特征信号（题号/题型/分值/空位等） */
    const hasChoice = options.length >= 2 && inputs.length >= 1;
    const hasText = texts.length > 0;
    /* 自定义可点击选项（无 input）的题目：有题目信号且能收集到 2 个以上选项行也可采信 */
    if (!(hasChoice || strong || (hasText && questionSignals(text)) || (options.length >= 2 && questionSignals(text)))) return null;

    return {
      qid: el.id || el.getAttribute('data-questionid') || el.getAttribute('data-id') || null,
      type, stem, options, blanks, images,
      el, anchor: el,
      els: { inputs, texts }
    };
  }

  function collectOptionRows(el, includeDivs) {
    const rows = [];
    try {
      el.querySelectorAll('label,li,.option,.answerOption,tr,.mark_item,.fl>a,.fl>span').forEach(r => {
        if (r.querySelector(CHOICE_INPUT)) rows.push(r);
      });
    } catch (e) { /* ignore */ }
    // 去嵌套：保留最内层带输入控件的行
    const kept = rows.filter(r => !rows.some(o => o !== r && r.contains(o)));
    if (kept.length) return kept;
    // 无输入控件的纯文本选项（兼容裸字母行/字母+中文/字母+数字，如「A」「A对」「A 2013年4月15日」）
    const sel = 'ul li,ol li,.option,p' + (includeDivs ? ',div' : '');
    const txt = [];
    el.querySelectorAll(sel).forEach(r => {
      const t = U.norm(r.innerText || r.textContent || '');
      if (t.length >= 1 && t.length <= 300 && /^\s*([A-Ha-h]\s*[、.．,，)）:：\s]?\s*(?=[\u4e00-\u9fa5\d]|$)|[（(]\s*[A-Ha-h]\s*[)）])/.test(t)) txt.push(r);
      if (txt.length >= 12) return;
    });
    return txt;
  }

  function parseOption(row, idx) {
    let text = U.norm(row.innerText || row.textContent || '');
    if (!text) return null;
    let key = null;
    const letterEl = row.querySelector('.num_option,.optionNum,.num,.letter,.letterNum');
    if (letterEl) {
      const lt = U.norm(letterEl.textContent || '').trim();
      if (/^[A-Za-z]$/.test(lt)) {
        key = lt.toUpperCase();
        const i = text.indexOf(lt);
        if (i === 0) text = text.slice(lt.length).replace(/^[、.．,，)）:：\s]+/, '');
      }
    }
    if (!key) {
      const m = /^\s*([A-Ha-h])\s*[、.．,，)）:：]?\s*(?=[\u4e00-\u9fa5\d]|$)/.exec(text);
      if (m) { key = m[1].toUpperCase(); text = text.slice(m[0].length).trim(); }
    }
    if (!key) {
      const m = /^\s*[（(]\s*([A-Ha-h])\s*[)）]\s*/.exec(text);
      if (m) { key = m[1].toUpperCase(); text = text.slice(m[0].length).trim(); }
    }
    if (!key) key = String.fromCharCode(65 + idx);
    /* 选项标签与文本分属相邻元素（如「A」与「2013年4月15日」两个 div）：合并相邻元素文本 */
    if (!text || /^[A-Ha-h]\s*[、.．,，)）:：]?\s*$/.test(text)) {
      const nx = row.nextElementSibling;
      if (nx && nx.isConnected) {
        const nt = U.norm(nx.innerText || nx.textContent || '').trim();
        if (nt && nt.length <= 120 && !/^\s*[（(]?\s*[A-Ha-h]\s*[、.．,，)）:：]/.test(nt) && !/^[A-Ha-h]\s*$/.test(nt)) {
          text = (text && !/^[A-Ha-h]\s*[、.．,，)）:：]?\s*$/.test(text) ? text + ' ' : '') + nt;
        }
      }
    }
    if (!text) text = '选项 ' + key;
    const img = row.querySelector('img');
    let image = null;
    if (img) {
      const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
      if (src && !/blank|spacer|loading|icon/i.test(src)) image = src;
    }
    return { key, label: text, image };
  }

  function deriveStem(el, optionRows) {
    let text = el.innerText || el.textContent || '';
    for (const row of optionRows) {
      const t = U.norm(row.innerText || row.textContent || '');
      if (t && t.length > 1) {
        const i = text.indexOf(t);
        if (i >= 0) text = text.slice(0, i) + ' ' + text.slice(i + t.length);
      }
    }
    return U.norm(text);
  }

  E.cleanStem = cleanStem;
  function cleanStem(s) {
    let t = U.norm(s);
    for (let i = 0; i < 3; i++) {
      const before = t;
      t = t.replace(/^\s*\d+\s*[、.．)）（【〕]\s*/, '');
      t = t.replace(/^\s*[（(【\[]\s*[^)）】〕\]]{1,14}\s*[)）】〕\]]\s*/, m => {
        const inner = m.replace(/^[（(【\[]\s*/, '').replace(/\s*[)）】〕\]]\s*$/, '');
        if (/^\d+(\.\d+)?$/.test(inner)) return ''; // （1）序号
        if (/单选|多选|判断|填空|简答|论述|名词|计算|分析|问答|其他|不定项|分|选择/.test(inner)) return '';
        return m;
      });
      t = t.replace(/^\s*(单选|多选|不定项|判断|填空|简答|问答|论述|名词解释|计算|分析|综合|选择\s*题)(题)?\s*[)）】〕]\s*/, '');
      if (t === before) break;
    }
    t = t.replace(/[（(]\s*\d+(\.\d+)?\s*分\s*[)）]\s*$/g, '').trim();
    return U.norm(t);
  }

  function detectType(el, options, head, stem, textCount) {
    const attrs = (el.getAttribute && (el.getAttribute('data-type') || el.getAttribute('typename') || el.getAttribute('qtype') || '')) || '';
    const src = (head + ' ' + stem.slice(0, 40) + ' ' + attrs);
    if (/不定项|多选/.test(src.slice(0, 60))) return 'multiple';
    if (/单选/.test(src.slice(0, 60))) return 'single';
    if (/判断/.test(src.slice(0, 60))) return 'judge';
    if (/填空/.test(src.slice(0, 60))) return 'fill';
    const hasText = textCount > 0 || !!el.querySelector(TEXT_CTRL);
    if (hasText && /简答|论述|名词解释|计算题|分析题|问答题|其他题|综合题/.test(src)) return 'short';
    if (options.length) {
      const hasCheckbox = !!el.querySelector('input[type=checkbox]');
      const j = options.map(o => o.label).join('').replace(/[^\u4e00-\u9fa5A-Za-z]/g, '').toLowerCase();
      if (options.length === 2 && /^(对错|正确错误|是否|tf|truefalse|yesno|\u221A\u00D7|\u00D7\u221A)$/.test(j)) return 'judge';
      return hasCheckbox ? 'multiple' : 'single';
    }
    if (hasText) return /简答|论述|名词解释|计算题|分析题|问答题|其他题/.test(src) ? 'short' : 'fill';
    return 'unknown';
  }

  function countBlanks(el, stem, texts) {
    // UEditor 一个空位会同时出现 .edui-container 与其内部 iframe/textarea：去重只算一次
    const ctrls = texts.filter(x => {
      const tag = x.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return true;
      if (tag === 'IFRAME') return !(x.closest && x.closest('.edui-container'));
      return !!(x.classList && x.classList.contains('edui-container'));
    });
    const n = ctrls.length;
    const m = stem.match(/_{2,}|[（(]\s*[)）]|\[\s*\]/g);
    const pat = m ? m.length : 0;
    // 学习通 dowork 作业/考试填空题：每个空位一个 .XztiHover1（span.fb 标「第N空」）
    const xz = el.querySelectorAll ? el.querySelectorAll('.Zy_ulTk .XztiHover1, .Cy_ulTk .XztiHover1').length : 0;
    // 控件数少于题干空位数时按题干计数（多空题只填第一空的根因：blanks 报少了）
    return Math.max(n, pat, xz, 1);
  }

  function collectImages(el) {
    const out = [];
    try {
      el.querySelectorAll('img').forEach(img => {
        const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
        if (!src || /^data:image\/(gif|svg)/i.test(src)) return;
        if (img.naturalWidth > 0 && img.naturalWidth < 40 && img.naturalHeight < 40) return;
        if (out.length < 6) out.push(src);
      });
    } catch (e) { /* ignore */ }
    return out;
  }

  /* ---------- 通用兜底：按同名输入控件分组 ---------- */
  function extractByInputGroups(d) {
    const groups = new Map();
    d.querySelectorAll(CHOICE_INPUT).forEach(inp => {
      if (!inp.name) return;
      if (!groups.has(inp.name)) groups.set(inp.name, []);
      groups.get(inp.name).push(inp);
    });
    const out = [];
    for (const [name, inputs] of groups) {
      if (inputs.length < 2) continue;
      const container = commonAncestor(inputs);
      let el = container;
      while (el && el !== d.documentElement && el.parentElement && U.norm(el.innerText || '').length < 15) {
        el = el.parentElement;
      }
      if (!el || el === d.documentElement || el === d.body) continue;
      const text = U.norm(el.innerText || '');
      if (text.length < 4) continue;
      const optionRows = [];
      inputs.forEach(i => {
        let row = i.closest('label,li,.option,tr');
        if (!row || optionRows.includes(row)) row = i.parentElement;
        if (row) optionRows.push(row);
      });
      const options = optionRows.map((r, i) => parseOption(r, i)).filter(Boolean);
      const stem = cleanStem(deriveStem(el, optionRows));
      if (!stem || stem.length < 2) continue;
      /* 兜底分组同样要过题目特征校验，避免把视频课里的筛选单选组（如清晰度/倍速）误判为题 */
      const cls = String((el.className || '') + ' ' + (el.id || ''));
      if (!questionSignals(text) && !/\b(question|topic|TiMu|ans|exam|work)\b/i.test(cls)) continue;
      out.push({
        qid: name || null,
        type: options.length ? (options.length === 2 && /^(对错|正确错误|是否)$/.test(options.map(o => o.label).join('')) ? 'judge' : (inputs.some(i => i.type === 'checkbox') ? 'multiple' : 'single')) : 'unknown',
        stem, options, blanks: 0, images: collectImages(el),
        el, anchor: el, els: { inputs, texts: [] }
      });
    }
    return out;
  }

  function commonAncestor(els) {
    if (!els.length) return null;
    let anc = els[0].parentElement;
    const containsAll = n => els.every(e => n && n.contains(e));
    while (anc && !containsAll(anc)) anc = anc.parentElement;
    return anc;
  }

  /* ---------- 终极兜底：按题目信号 + 选项行扫描任意容器（无 input 的自定义点击选项页） ---------- */
  function extractBySignals(d, covered, foundEls) {
    const out = [];
    const used = new Set();
    const cands = Array.from(d.querySelectorAll('div,li,section,td,fieldset,p'));
    const depth = el => { let n = 0, p = el; while (p && p.parentElement) { n++; p = p.parentElement; } return n; };
    cands.sort((a, b) => depth(b) - depth(a)); // 由内向外：先小容器后大容器
    for (const el of cands) {
      if (!el.isConnected) continue;
      const text = U.norm(el.innerText || el.textContent || '');
      if (text.length < 10 || text.length > 600) continue;
      if (!questionSignals(text)) continue;
      const options = collectOptionRows(el, true).map((r, i) => parseOption(r, i)).filter(Boolean);
      if (options.length < 2) continue;
      let skip = false;
      used.forEach(u => { if (el.contains(u) || u.contains(el)) skip = true; });
      foundEls.forEach(u => { if (el.contains(u) || u.contains(el)) skip = true; });
      covered.forEach(c => { if (el.contains(c)) skip = true; });
      if (skip) continue;
      const q = extractContainer(el, d, false, true);
      if (!q) continue;
      used.add(el);
      out.push(q);
    }
    return out;
  }

  /* ---------- 孤儿文本框（填空/简答不在容器内时） ---------- */
  function orphanTexts(d, covered, questions, foundEls) {
    d.querySelectorAll('textarea,input[type=text],input:not([type]),iframe.edui-body-frame,.edui-container').forEach(t => {
      if (covered.has(t)) return;
      let wrap = t.closest('.TiMu,.questionLi,div[id],td,.form-group,.Que');
      let stem = '';
      if (wrap) {
        stem = U.norm(wrap.innerText || wrap.textContent || '');
        if (t.value) stem += ' 已填内容:' + t.value;
        if (t.placeholder) stem += ' 提示:' + t.placeholder;
      } else {
        let prev = t;
        while ((prev = prev.previousElementSibling)) {
          const tx = U.norm(prev.innerText || prev.textContent || '');
          if (tx && tx.length >= 3) { stem = tx; break; }
        }
      }
      /* 孤儿文本框校验：视频课评论框/笔记框等没有题目特征的不算题（用清洗前的原始文本判断，保留题号信号） */
      const rawSig = questionSignals(stem) || /(answer|答案|key|ans|blank)/i.test(String(t.name || t.id || ''));
      stem = cleanStem(stem);
      if (!stem || stem.length < 2) return;
      if (!rawSig) return;
      questions.push({
        qid: t.id || t.name || null,
        type: /简答|论述|名词解释|计算题|分析题|问答题|其他题/.test(stem) ? 'short' : 'fill',
        stem, options: [], blanks: 1, images: collectImages(wrap || t),
        el: wrap || t, anchor: t, els: { inputs: [], texts: [t] }
      });
      foundEls.add(wrap || t);
      covered.add(t);
    });
  }

  /* ---------- 序列化（去掉 DOM 引用，发给模型） ---------- */
  E.serialize = function (q) {
    return {
      index: q.index,
      type: q.type,
      stem: q.stem,
      options: (q.options || []).map(o => ({ key: o.key, label: o.label })),
      blanks: q.blanks || 0,
      images: q.images || []
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);