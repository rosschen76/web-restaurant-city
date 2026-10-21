/* 共用小工具：亂數、事件、格式化。純邏輯，Node 與瀏覽器皆可載入。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  /** mulberry32：可指定種子，測試時結果可重現。 */
  function makeRng(seed) {
    let s = seed >>> 0;
    const next = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      range: (a, b) => a + (b - a) * next(),
      /** 含頭含尾的整數 */
      int: (a, b) => Math.floor(a + (b - a + 1) * next()),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      chance: (p) => next() < p,
    };
  }

  class Emitter {
    constructor() {
      this.m = new Map();
    }
    on(name, fn) {
      if (!this.m.has(name)) this.m.set(name, []);
      this.m.get(name).push(fn);
      return () => this.off(name, fn);
    }
    off(name, fn) {
      const l = this.m.get(name);
      if (l) this.m.set(name, l.filter((f) => f !== fn));
    }
    emit(name, a, b) {
      const l = this.m.get(name);
      if (l) for (const f of l.slice()) f(a, b);
    }
  }

  /** 1234 -> "1,234"；12345 -> "12.3K"；1234567 -> "1.23M" */
  function fmt(n) {
    n = Math.floor(n);
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, '') + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  RC.util = { clamp, lerp, makeRng, Emitter, fmt };
})(typeof globalThis !== 'undefined' ? globalThis : window);
