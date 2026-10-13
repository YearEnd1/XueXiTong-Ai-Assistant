/* 学习通 AI 自动答题助手  配置与缓存存取（chrome.storage） */
(function (root) {
  'use strict';
  const CQ = (root.CQ = root.CQ || {});
  const S = (CQ.store = CQ.store || {});

  S.normalize = function (raw) {
    const cfg = Object.assign({}, CQ.DEFAULT_CONFIG, raw || {});
    // 数值边界保护
    cfg.batchSize = Math.min(20, Math.max(1, parseInt(cfg.batchSize, 10) || 5));
    cfg.requestDelayMs = Math.min(60000, Math.max(0, parseInt(cfg.requestDelayMs, 10) || 0));
    cfg.maxTokens = Math.min(32000, Math.max(128, parseInt(cfg.maxTokens, 10) || 2048));
    cfg.timeoutMs = Math.min(300000, Math.max(5000, parseInt(cfg.timeoutMs, 10) || 60000));
    cfg.temperature = Math.min(2, Math.max(0, parseFloat(cfg.temperature) || 0));
    cfg.minConfidence = Math.min(1, Math.max(0, parseFloat(cfg.minConfidence) || 0));
    cfg.baseUrl = String(cfg.baseUrl || '').trim().replace(/\/+$/, '');
    return cfg;
  };

  S.get = function () {
    return new Promise(resolve => {
      try {
        chrome.storage.local.get('cqConfig', r => {
          const err = chrome.runtime.lastError;
          resolve(S.normalize(err ? null : r && r.cqConfig));
        });
      } catch (e) { resolve(S.normalize(null)); }
    });
  };

  S.set = function (cfg) {
    return new Promise(resolve => {
      try {
        chrome.storage.local.set({ cqConfig: S.normalize(cfg) }, () => {
          resolve(S.normalize(cfg));
        });
      } catch (e) { resolve(S.normalize(cfg)); }
    });
  };

  /* 缓存存后台（由 service worker 统一维护，LRU 上限） */
  S.cacheKeyOf = function (q) {
    const sig = [q.type, q.stem, (q.options || []).map(o => o.key + ':' + o.label).join('|')].join('\u0001');
    return CQ.util.hash(sig);
  };

  S.cacheGet = function (keys) {
    return new Promise(resolve => {
      CQ.util.safeSend({ type: CQ.MSG.CACHE_GET, keys }).then(r => resolve(r && r.hits ? r.hits : {}))
        .catch(() => resolve({}));
    });
  };

  S.cacheSet = function (entries) {
    CQ.util.safeSend({ type: CQ.MSG.CACHE_SET, entries }).catch(() => {});
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);