/* 学习通 AI 自动答题助手  通用工具函数 */
(function (root) {
  'use strict';
  const CQ = (root.CQ = root.CQ || {});
  const U = (CQ.util = CQ.util || {});

  U.norm = function (s) {
    return String(s == null ? '' : s)
      .replace(/\u00a0/g, ' ')
      .replace(/[\t\r]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();
  };

  U.sleep = function (ms) { return new Promise(r => setTimeout(r, ms)); };

  /* 稳定字符串哈希（djb2，十进制字符串输出），用于缓存键 */
  U.hash = function (s) {
    let h = 5381;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  };

  U.uuid = function () {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  U.debounce = function (fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  };

  /* 尽力把模型输出解析成 JSON（剥代码块围栏、截取首尾括号等） */
  U.parseLooseJson = function (text) {
    let s = String(text || '').trim();
    if (!s) return null;
    s = s.replace(/^```[a-zA-Z]*\s*/g, '').replace(/\s*```$/g, '').trim();
    if (s[0] === '\uFEFF') s = s.slice(1);
    try { return JSON.parse(s); } catch (e) { /* 继续尝试 */ }
    const candidates = [];
    if (s[0] !== '[' && s[0] !== '{') {
      const i = s.search(/[[{]/);
      if (i > 0) s = s.slice(i);
    }
    if (s.startsWith('{')) {
      const j = s.lastIndexOf('}');
      if (j > 0) candidates.push(s.slice(0, j + 1));
    }
    if (s.startsWith('[')) {
      const j = s.lastIndexOf(']');
      if (j > 0) candidates.push(s.slice(0, j + 1));
    }
    // 数组开头但被截断时优先按数组修复（否则后面的 {..} 贪婪匹配会误救出半个对象）
    if (s.startsWith('[')) {
      const fixedArr = repairTruncatedArray(s);
      if (fixedArr) {
        try { return JSON.parse(fixedArr); } catch (e) { /* ignore */ }
      }
    }
    const mArr = s.match(/\[[\s\S]*\]/);
    if (mArr) candidates.push(mArr[0]);
    const mObj = s.match(/\{[\s\S]*\}/);
    if (mObj) candidates.push(mObj[0]);
    for (const c of candidates) {
      try { return JSON.parse(c); } catch (e) { /* next */ }
    }
    // 截断修复：输出被 max_tokens 切断时，回退到最后一个完整元素并补齐括号
    const fixed = repairTruncatedArray(s);
    if (fixed) {
      try { return JSON.parse(fixed); } catch (e) { /* ignore */ }
    }
    return null;
  };

  /* 把未闭合的 JSON 数组裁到最后一个完整元素并补齐 ] */
  function repairTruncatedArray(s) {
    const open = s.indexOf('[');
    if (open < 0) return null;
    let depth = 0, inStr = false, esc = false, lastTop = -1;
    for (let i = open; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) return null; // 已正常闭合，无需修复
        if (depth === 1) lastTop = i;
      }
    }
    if (lastTop < 0) return null;
    let out = s.slice(open, lastTop + 1);
    let d = 0, q = false, sc = false;
    for (let i = 0; i < out.length; i++) {
      const ch = out[i];
      if (q) { if (sc) sc = false; else if (ch === '\\') sc = true; else if (ch === '"') q = false; continue; }
      if (ch === '"') q = true;
      else if (ch === '[' || ch === '{') d++;
      else if (ch === ']' || ch === '}') d--;
    }
    if (q) out += '"';
    while (d-- > 0) out += ']';
    return out;
  }

  U.safeSend = function (msg) {
    try { return chrome.runtime.sendMessage(msg); }
    catch (e) { return Promise.reject(e); }
  };

  /* 基础 64 位数组分块 */
  U.chunk = function (arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  };

  /* 安全 JSON 字符串化（兜底替换非法字符） */
  U.json = function (v) {
    try { return JSON.stringify(v, null, 2); }
    catch (e) { return String(v); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);