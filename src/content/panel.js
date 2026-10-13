/* 学习通 AI 自动答题助手  悬浮操作面板（Shadow DOM 隔离样式，可拖动/折叠） */
(function (root) {
  'use strict';
  const CQ = (root.CQ = root.CQ || {});
  const P = (CQ.panel = CQ.panel || {});

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: "Microsoft YaHei","PingFang SC",system-ui,sans-serif; }
.card {
  width: 336px; background: #ffffff; border-radius: 12px;
  box-shadow: 0 8px 30px rgba(0,0,0,.18), 0 2px 8px rgba(0,0,0,.12);
  border: 1px solid #e2e8f0; overflow: hidden; user-select: none;
}
.head {
  display: flex; align-items: center; gap: 6px; padding: 8px 10px;
  background: linear-gradient(135deg,#2563eb,#4f46e5); color: #fff;
  cursor: move; font-size: 13px;
}
.head .title { font-weight: 600; flex: 1; }
.pill { font-size: 11px; background: rgba(255,255,255,.2); padding: 2px 8px; border-radius: 999px; }
.pill.ok { background: #16a34a; }
.pill.busy { background: #d97706; }
.pill.err { background: #dc2626; }
.head button {
  border: 0; background: rgba(255,255,255,.18); color: #fff; width: 22px; height: 22px;
  border-radius: 6px; cursor: pointer; font-size: 13px; line-height: 1;
}
.head button:hover { background: rgba(255,255,255,.32); }
.body { padding: 10px; font-size: 12px; color: #1e293b; }
.status { margin-bottom: 6px; min-height: 16px; color: #475569; }
.status.err { color: #dc2626; }
.status.ok { color: #16a34a; }
.stats { margin-bottom: 6px; color: #64748b; }
.results { max-height: 240px; overflow: auto; margin-bottom: 8px; border-top: 1px solid #e2e8f0; }
.row { padding: 5px 2px; border-bottom: 1px solid #f1f5f9; line-height: 1.5; }
.row .idx { display: inline-block; min-width: 20px; color: #2563eb; font-weight: 600; }
.row .type { display: inline-block; background: #eff6ff; color: #2563eb; border-radius: 4px; padding: 0 4px; margin-right: 4px; font-size: 11px; }
.row .ans { font-weight: 600; }
.row .conf { color: #94a3b8; font-size: 11px; margin-left: 4px; }
.row .why { color: #64748b; display: block; font-size: 11px; margin-top: 1px; }
.row.ok { border-left: 3px solid #16a34a; }
.row.skip { border-left: 3px solid #94a3b8; color: #94a3b8; }
.row.fail { border-left: 3px solid #dc2626; }
.row.pend { border-left: 3px solid #2563eb; }
.btns { display: flex; gap: 6px; flex-wrap: wrap; }
.btns button {
  flex: 1; min-width: 58px; padding: 6px 4px; border-radius: 8px; cursor: pointer;
  border: 1px solid #cbd5e1; background: #fff; color: #334155; font-size: 12px;
}
.btns button:hover { background: #f1f5f9; }
.btns .primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.btns .primary:hover { background: #1d4ed8; }
.btns .danger { color: #dc2626; border-color: #fecaca; }
.btns .danger:hover { background: #fef2f2; }
.btns button:disabled { opacity: .5; cursor: not-allowed; }
.foot { margin-top: 8px; color: #94a3b8; font-size: 11px; border-top: 1px dashed #e2e8f0; padding-top: 6px; }
.collapsed .body { display: none; }
`;

  let host = null, shadow = null, els = {}, cfg = null;
  const handlers = new Map();
  const state = { busy: false };

  function h(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  P.mount = function (opts) {
    if (host && host.isConnected) return;
    cfg = opts.cfg || CQ.DEFAULT_CONFIG;
    host = document.createElement('div');
    host.id = 'cq-ai-panel-host';
    host.style.cssText = 'position:fixed;z-index:2147483000;top:120px;right:16px;';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const card = h(`
<div class="card" data-card>
  <div class="head" data-head>
    <span></span><span class="title">学习通 AI 答题助手</span>
    <span class="pill" data-pill>待识别</span>
    <button title="折叠/展开" data-min></button>
    <button title="关闭（刷新页面恢复）" data-close></button>
  </div>
  <div class="body">
    <div class="status" data-status>正在初始化</div>
    <div class="stats" data-stats></div>
    <div class="results" data-results></div>
    <div class="btns">
      <button data-cmd="rescan">识别</button>
      <button data-cmd="answer" class="primary">AI 答题</button>
      <button data-cmd="apply">应用</button>
      <button data-cmd="clear">清空</button>
      <button data-cmd="submit" class="danger">交卷</button>
    </div>
    <div class="foot" data-foot></div>
  </div>
</div>`);
    shadow.appendChild(card);
    els = {
      card, head: card.querySelector('[data-head]'), pill: card.querySelector('[data-pill]'),
      status: card.querySelector('[data-status]'), stats: card.querySelector('[data-stats]'),
      results: card.querySelector('[data-results]'), foot: card.querySelector('[data-foot]'),
      min: card.querySelector('[data-min]'), close: card.querySelector('[data-close]')
    };

    if (cfg.uiPos) {
      host.style.left = cfg.uiPos.x + 'px';
      host.style.top = cfg.uiPos.y + 'px';
      host.style.right = 'auto';
    }
    if (cfg.uiCollapsed) {
      els.card.classList.add('collapsed');
      els.min.textContent = '+';
    }

    // 拖动
    let dragging = null;
    els.head.addEventListener('pointerdown', e => {
      if (e.target === els.min || e.target === els.close) return;
      dragging = { dx: e.clientX - host.getBoundingClientRect().left, dy: e.clientY - host.getBoundingClientRect().top };
      els.head.setPointerCapture(e.pointerId);
    });
    // 边界判定：以浏览器窗口（视口）为界，拖动时面板始终保持完整可见
    const clampToViewport = () => {
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      if (!vw || !vh || !host.isConnected) return;
      const w = host.offsetWidth, h = host.offsetHeight;
      let x = parseFloat(host.style.left);
      let y = parseFloat(host.style.top);
      if (Number.isNaN(x)) x = host.getBoundingClientRect().left;
      if (Number.isNaN(y)) y = host.getBoundingClientRect().top;
      x = Math.min(Math.max(0, x), Math.max(0, vw - w));
      y = Math.min(Math.max(0, y), Math.max(0, vh - h));
      host.style.left = x + 'px';
      host.style.top = y + 'px';
      host.style.right = 'auto';
    };
    clampToViewport();
    window.addEventListener('resize', CQ.util.debounce(clampToViewport, 150));
    els.head.addEventListener('pointermove', e => {
      if (!dragging) return;
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      const w = host.offsetWidth, h = host.offsetHeight;
      const x = Math.min(Math.max(0, e.clientX - dragging.dx), Math.max(0, vw - w));
      const y = Math.min(Math.max(0, e.clientY - dragging.dy), Math.max(0, vh - h));
      host.style.left = x + 'px';
      host.style.top = y + 'px';
      host.style.right = 'auto';
    });
    els.head.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = null;
      const r = host.getBoundingClientRect();
      CQ.store.get().then(c => CQ.store.set({ ...c, uiPos: { x: Math.round(r.left), y: Math.round(r.top) } }));
    });

    els.min.addEventListener('click', () => {
      const collapsed = els.card.classList.toggle('collapsed');
      els.min.textContent = collapsed ? '+' : '';
      CQ.store.get().then(c => CQ.store.set({ ...c, uiCollapsed: collapsed }));
    });
    els.close.addEventListener('click', () => P.destroy());
    card.querySelectorAll('[data-cmd]').forEach(btn => {
      btn.addEventListener('click', () => {
        const fn = handlers.get(btn.dataset.cmd);
        if (fn) fn();
      });
    });

    document.body.appendChild(host);
  };

  P.destroy = function () { if (host) { host.remove(); host = null; shadow = null; } };
  P.mounted = function () { return !!(host && host.isConnected); };

  P.on = function (cmd, fn) { handlers.set(cmd, fn); };

  P.setStatus = function (text, tone) {
    if (!els.status) return;
    els.status.textContent = text || '';
    els.status.className = 'status' + (tone ? ' ' + tone : '');
    els.pill.textContent = tone === 'busy' ? '处理中' : (tone === 'ok' ? '已完成' : tone === 'err' ? '出错' : '待识别');
    els.pill.className = 'pill' + (tone ? ' ' + tone : '');
  };

  P.setStats = function (text) { if (els.stats) els.stats.innerHTML = text || ''; };
  P.setFoot = function (text) { if (els.foot) els.foot.textContent = text || ''; };

  P.setBusy = function (busy) {
    state.busy = busy;
    const b = els.card && els.card.querySelector('[data-cmd="answer"]');
    if (b) b.disabled = busy;
  };

  P.showResults = function (res, map) {
    if (!els.results) return;
    if (!res) { els.results.innerHTML = ''; return; }
    const rows = [];
    for (const it of res.pending || []) rows.push(rowHtml(it, 'pend'));
    for (const it of res.applied) rows.push(rowHtml(it, 'ok'));
    for (const it of res.skipped) rows.push(rowHtml(it, 'skip'));
    for (const it of res.failed) rows.push(rowHtml(it, 'fail'));
    els.results.innerHTML = rows.join('') || '<div class="row">暂无结果</div>';
  };

  function rowHtml(it, tone) {
    const ans = (it.answer || []).join('、') || '';
    const conf = typeof it.confidence === 'number' ? it.confidence.toFixed(2) : '';
    const why = it.reason ? `<span class="why">${escapeHtml(it.reason)}</span>` : '';
    const reason = it.reason2 ? `<span class="why">${escapeHtml(it.reason2)}</span>` : why;
    return `<div class="row ${tone}"><span class="idx">${it.index}</span><span class="type">${escapeHtml(CQ.TYPE_LABELS[it.type] || it.type || '')}</span><span class="ans">${escapeHtml(ans)}</span>${conf ? `<span class="conf">${conf}</span>` : ''}${reason}</div>`;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- 轻提示 ---------- */
  let toastHost = null, toastTimer = null;
  P.toast = function (text, tone) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.style.cssText = 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:2147483001;';
      document.body.appendChild(toastHost);
      toastHost.attachShadow({ mode: 'open' }).innerHTML = `<style>
        div { font-family:"Microsoft YaHei",system-ui,sans-serif; font-size:13px; padding:8px 16px;
          border-radius:8px; background:${tone === 'err' ? '#dc2626' : '#166534'}; color:#fff;
          box-shadow:0 4px 16px rgba(0,0,0,.25); white-space:nowrap; max-width:80vw; overflow:hidden; text-overflow:ellipsis; }
      </style><div></div>`;
    }
    const box = toastHost.shadowRoot.querySelector('div');
    box.style.background = tone === 'err' ? '#dc2626' : (tone === 'busy' ? '#b45309' : '#166534');
    box.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (toastHost) toastHost.remove(); toastHost = null; }, 2600);
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);