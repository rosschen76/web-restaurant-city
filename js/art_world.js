/* 像素美術（場景）：地板、牆壁、全部家具。皆於載入時程式化繪製成小圖。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});
  const gfx = RC.gfx;
  const { canvas, ctx, shade, mix, poly, ellipse, brush, outline, hash } = gfx;
  const D = RC.data;

  const WALL_H = 44;
  const SLAB = 6;
  const frac = (v) => v - Math.floor(v);

  /* ───────── 地板：逐像素著色器 ───────── */

  /** 32×16 菱形；fn(u,v,x,y) 回傳顏色或 null */
  function bakeTile(fn) {
    const c = canvas(32, 16);
    const g = ctx(c);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 32; x++) {
        const px = x + 0.5 - 16;
        const py = y + 0.5;
        const u = (px / 16 + py / 8) / 2;
        const v = (py / 8 - px / 16) / 2;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const col = fn(u, v, x, y);
        if (col) {
          g.fillStyle = col;
          g.fillRect(x, y, 1, 1);
        }
      }
    }
    return c;
  }

  const FLOORS = {
    wood: (alt) => (u, v, x, y) => {
      const band = Math.floor(v * 4);
      const tone = [1, 0.92, 0.97, 0.88][(band + (alt ? 2 : 0)) & 3];
      let col = shade('#cf9760', tone);
      const joint = frac(u * 2 + band * 0.37 + (alt ? 0.5 : 0));
      if (joint < 0.07) col = shade(col, 0.82);
      if (frac(v * 4) < 0.13) col = shade(col, 0.8);
      if (hash(x, y, 3) < 0.07) col = shade(col, 0.93);
      return col;
    },
    brick: (alt) => (u, v, x, y) => {
      const row = Math.floor(v * 5);
      const off = (row & 1 ? 0.5 : 0) + (alt ? 0.25 : 0);
      const mortar = frac(v * 5) < 0.14 || frac(u * 2 + off) < 0.1;
      if (mortar) return '#9a7a66';
      return shade('#b95a3c', 0.9 + hash(x, y, 5) * 0.2);
    },
    checker: (alt) => (u, v) => {
      const dark = (Math.floor(u * 2) + Math.floor(v * 2) + (alt ? 1 : 0)) & 1;
      const edge = u < 0.04 || v < 0.04;
      const col = dark ? '#3f3b4a' : '#eee7d8';
      return edge ? shade(col, 0.9) : col;
    },
    tatami: (alt) => (u, v, x, y) => {
      const a = alt ? v : u;
      const b = alt ? u : v;
      if (b < 0.06 || b > 0.94 || a < 0.03) return '#3f4d27';
      const weave = (y + (alt ? 1 : 0)) & 1;
      return weave ? '#b9c47a' : '#aab86a';
    },
    marble: (alt) => (u, v, x, y) => {
      if (u < 0.035 || v < 0.035) return '#b9b6c2';
      const vein = Math.sin((u * 3.1 + v * 4.7 + hash(Math.floor(x / 5), Math.floor(y / 5), 9) * 2) * 6);
      let col = alt ? '#e7e4ea' : '#efecf1';
      if (Math.abs(vein) < 0.12) col = '#cfccd8';
      return col;
    },
  };

  /* ───────── 牆壁 ───────── */

  /** 回傳 (s:0~1 沿牆位置, t:離地像素, seg:變體, x,y) → 顏色 */
  const WALL_THEMES = {
    cream: (s, t) => {
      if (t < 1) return '#8a6d45';
      if (t < 11) return '#c9a56c';
      if (t < 13) return '#a8864f';
      if (t >= WALL_H - 3) return '#ead9b0';
      return '#f2e2bd';
    },
    red: (s, t) => {
      if (t < 1) return '#4a2018';
      if (t < 11) return '#6e3324';
      if (t < 13) return '#e0b44a';
      if (t >= WALL_H - 3) return '#e0b44a';
      return Math.floor(s * 16) & 1 ? '#bf352d' : '#c8403a';
    },
    brick: (s, t, x, y) => {
      if (t < 1) return '#4a2f26';
      if (t >= WALL_H - 3) return '#c47a5c';
      const row = Math.floor(t / 5);
      const mortar = t % 5 < 1 || (x + (row & 1 ? 4 : 0)) % 8 === 0;
      return mortar ? '#c9a794' : shade('#a4503a', 0.92 + hash(x, y, 2) * 0.16);
    },
    bamboo: (s, t, x) => {
      if (t < 1) return '#6a6a30';
      if (t >= WALL_H - 3) return '#8a9448';
      if (t % 14 < 1) return '#7d8a3c';
      return (x >> 1) & 1 ? '#c4cf7c' : '#d3dd8e';
    },
    night: (s, t, x) => {
      if (t < 1) return '#10162e';
      if (t >= WALL_H - 3) return '#e0b44a';
      if (t < 8) return '#1c2650';
      const px = (x % 8) - 4;
      const py = (t % 8) - 4;
      if (Math.abs(px) + Math.abs(py) < 2) return '#e0b44a';
      return Math.abs(px) + Math.abs(py) < 5 ? '#3b52a0' : '#2d3f78';
    },
  };

  function wallPixel(theme, kind, s, t, x, y) {
    const base = WALL_THEMES[theme](s, t, x, y);
    if (kind === 'window') {
      if (s > 0.16 && s < 0.84 && t > 15 && t < 37) {
        const edge = s < 0.2 || s > 0.8 || t < 18 || t > 34 || Math.abs(s - 0.5) < 0.035 || Math.abs(t - 26) < 1.2;
        if (edge) return '#6b4528';
        return t > 29 ? '#bfe6f6' : '#92cdea';
      }
      if (s > 0.12 && s < 0.88 && t > 13 && t <= 15) return '#e8d4a8';
    }
    if (kind === 'door') {
      if (s > 0.06 && s < 0.94 && t < 40) {
        const edge = s < 0.12 || s > 0.88 || t > 36;
        if (edge) return '#a8302a';
        if (s < 0.17 || s > 0.83 || t > 35) return '#e0b44a';
        // 門外的街景：天空與草地
        if (t < 4) return '#6aa84f';
        return t < 14 ? '#cfe8a8' : '#fff1c9';
      }
      if (s > 0.04 && s < 0.96 && t >= 40 && t < 44) return Math.floor(s * 10) % 2 ? '#d63b32' : '#f2f0ea';
    }
    return base;
  }

  /** 左牆的一段（16 寬）；右牆由水平翻轉取得。 */
  function bakeWallSeg(theme, kind) {
    const c = canvas(16, WALL_H + 8);
    const g = ctx(c);
    for (let x = 0; x < 16; x++) {
      const top = 8 - (x + 0.5) / 2;
      for (let y = 0; y < WALL_H + 8; y++) {
        const yc = y + 0.5;
        if (yc < top || yc >= top + WALL_H) continue;
        const t = top + WALL_H - yc;
        g.fillStyle = wallPixel(theme, kind, (x + 0.5) / 16, t, x, y);
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  /** 整個餐廳的靜態底圖（牆 + 地板 + 地板厚度），含外圍描邊。 */
  function bakeRoom(stage, floorId, wallId) {
    const room = D.expansions[stage];
    const { w, h } = room;
    const pad = 3;
    const ox = h * 16 + pad;
    const oy = WALL_H + pad;
    const c = canvas((w + h) * 16 + pad * 2, (w + h) * 8 + WALL_H + SLAB + pad * 2);
    const g = ctx(c);
    const proj = (gx, gy) => [ox + (gx - gy) * 16, oy + (gx + gy) * 8];
    // 牆
    const segs = {};
    const seg = (kind) => segs[kind] || (segs[kind] = bakeWallSeg(wallId, kind));
    for (let gy = 0; gy < h; gy++) {
      const [ax, ay] = proj(0, gy);
      const kind = gy === D.DOOR_Y ? 'door' : gy % 4 === 1 ? 'window' : 'plain';
      g.drawImage(seg(kind), ax - 16, ay - WALL_H);
    }
    for (let gx = 0; gx < w; gx++) {
      const [ax, ay] = proj(gx, 0);
      const kind = gx % 4 === 2 ? 'window' : 'plain';
      g.save();
      g.translate(ax + 16, ay - WALL_H);
      g.scale(-1, 1);
      g.drawImage(seg(kind), 0, 0);
      g.restore();
    }
    // 右牆整體壓暗：只覆蓋右牆範圍
    const dark = canvas(c.width, c.height);
    const dg = ctx(dark);
    for (let gx = 0; gx < w; gx++) {
      const [ax, ay] = proj(gx, 0);
      poly(dg, [[ax, ay - WALL_H], [ax + 16, ay + 8 - WALL_H], [ax + 16, ay + 8], [ax, ay]], 'rgba(30,20,50,0.16)');
    }
    g.drawImage(dark, 0, 0);
    // 牆角柱
    const [cx, cy] = proj(0, 0);
    gfx.rect(g, shade('#d9c08c', 0.8), cx - 1, cy - WALL_H, 3, WALL_H);
    // 地板
    const tiles = [bakeTile(FLOORS[floorId](false)), bakeTile(FLOORS[floorId](true))];
    for (let gy = 0; gy < h; gy++)
      for (let gx = 0; gx < w; gx++) {
        const [px, py] = proj(gx, gy);
        g.drawImage(tiles[(gx + gy) & 1], px - 16, py);
      }
    // 地板厚度
    for (let gy = 0; gy < h; gy++) {
      const a = proj(w, gy);
      const b = proj(w, gy + 1);
      poly(g, [a, b, [b[0], b[1] + SLAB], [a[0], a[1] + SLAB]], '#5e3d24');
    }
    for (let gx = 0; gx < w; gx++) {
      const a = proj(gx, h);
      const b = proj(gx + 1, h);
      poly(g, [a, b, [b[0], b[1] + SLAB], [a[0], a[1] + SLAB]], '#7d5232');
    }
    outline(c);
    return { c, ox, oy, w, h };
  }

  /* ───────── 家具 ───────── */

  const woodSet = (b, c, legs, d) => {
    for (const [u, v] of [[0.08, 0.08], [0.76, 0.08], [0.08, 0.76], [0.76, 0.76]]) b.box(u, v, u + 0.16, v + 0.16, 0, d, legs);
  };

  // 每項: h=額外高度(像素), fn(b, info)；info={rot, face, part, fw, fh}
  const DRAW = {};

  /* 桌子 */
  DRAW.table_wood = { h: 16, fn(b) {
    woodSet(b, null, '#6e4226', 9);
    b.box(0.02, 0.02, 0.98, 0.98, 9, 12, '#c98a52');
    b.flat(0.1, 0.24, 0.9, 0.27, 12, '#b4733f');
    b.flat(0.1, 0.5, 0.9, 0.53, 12, '#b4733f');
    b.flat(0.1, 0.74, 0.9, 0.77, 12, '#b4733f');
  } };
  DRAW.table_round = { h: 18, fn(b) {
    b.cyl(0.5, 0.5, 0, 3, 4, 2, '#7a5a38', '#5e4228');
    b.cyl(0.5, 0.5, 2, 12, 12, 6, '#f6f1e6', '#d5ccb8');
    b.disc(0.5, 0.5, 12, 9, 4, '#fffaf0');
    b.disc(0.5, 0.5, 12, 3, 1, '#d94f43');
  } };
  DRAW.table_long = { h: 16, fn(b) {
    for (const [u, v] of [[0.08, 0.08], [1.76, 0.08], [0.08, 0.76], [1.76, 0.76]]) b.box(u, v, u + 0.16, v + 0.16, 0, 9, '#6e4226');
    b.box(0.02, 0.04, 1.98, 0.96, 9, 12, '#b07040');
    b.flat(0.14, 0.34, 1.86, 0.66, 12, '#8f2d2d');
    b.flat(0.14, 0.4, 1.86, 0.43, 12, '#e0b44a');
    b.flat(0.14, 0.57, 1.86, 0.6, 12, '#e0b44a');
  } };
  DRAW.table_red = { h: 18, fn(b) {
    for (const [u, v] of [[0.08, 0.08], [0.74, 0.08], [0.08, 0.74], [0.74, 0.74]]) {
      b.box(u, v, u + 0.18, v + 0.18, 0, 9, '#5a1f1b');
      b.box(u - 0.02, v - 0.02, u + 0.2, v + 0.2, 7, 9, '#e0b44a');
    }
    b.box(0.08, 0.08, 0.92, 0.92, 7, 10, '#6e2622');
    b.box(0, 0, 1, 1, 10, 13, '#8c2f2a');
    b.flat(0.1, 0.1, 0.9, 0.9, 13, '#a43a33');
    b.flat(0.16, 0.16, 0.84, 0.2, 13, '#e0b44a');
    b.flat(0.16, 0.8, 0.84, 0.84, 13, '#e0b44a');
    b.flat(0.16, 0.16, 0.2, 0.84, 13, '#e0b44a');
    b.flat(0.8, 0.16, 0.84, 0.84, 13, '#e0b44a');
  } };
  DRAW.table_marble = { h: 20, fn(b) {
    b.box(0.3, 0.3, 0.7, 0.7, 0, 10, '#bdb7c4');
    b.box(0.15, 0.15, 0.85, 0.85, 0, 3, '#d8d3de');
    b.box(0, 0, 1, 1, 10, 14, '#f2f0f4');
    b.flat(0.06, 0.06, 0.94, 0.94, 14, '#e6e3ea');
    b.flat(0.2, 0.3, 0.8, 0.33, 14, '#cbc7d4');
    b.flat(0.35, 0.6, 0.7, 0.63, 14, '#cbc7d4');
    b.box(0, 0, 1, 1, 10, 11, '#e0b44a', { top: '#e0b44a' });
  } };

  /* 椅子 */
  function chairBack(b, face, z0, z1, col, o) {
    const T = 0.14;
    if (face === 0) b.box(0.04, 0.1, 0.04 + T, 0.9, z0, z1, col, o);
    else if (face === 1) b.box(0.1, 0.04, 0.9, 0.04 + T, z0, z1, col, o);
    else if (face === 2) b.box(0.96 - T, 0.1, 0.96, 0.9, z0, z1, col, o);
    else b.box(0.1, 0.96 - T, 0.9, 0.96, z0, z1, col, o);
  }
  function chair(cfg) {
    return {
      h: cfg.h,
      fn(b, info) {
        const front = info.face >= 2; // 椅背在人前面
        const doBack = () => {
          chairBack(b, info.face, cfg.seatZ, cfg.backZ, cfg.back, cfg.backO);
          };
        if (info.part === 'back') {
          if (front) doBack();
          return;
        }
        if (info.part === 'all' && !front) doBack();
        for (const [u, v] of [[0.14, 0.14], [0.7, 0.14], [0.14, 0.7], [0.7, 0.7]]) b.box(u, v, u + 0.16, v + 0.16, 0, cfg.seatZ - 2, cfg.legs);
        b.box(0.08, 0.08, 0.92, 0.92, cfg.seatZ - 2, cfg.seatZ, cfg.seat, cfg.seatO);
        if (cfg.pad) b.flat(0.18, 0.18, 0.82, 0.82, cfg.seatZ, cfg.pad);
        if (info.part === 'all' && front) doBack();
      },
    };
  }
  DRAW.chair_stool = { h: 12, fn(b, info) {
    if (info.part === 'back') return;
    b.cyl(0.5, 0.5, 0, 5, 3, 1, '#7a4a2a', '#6e4226');
    b.cyl(0.5, 0.5, 5, 7, 8, 4, '#e0a35e', '#a8703a');
  } };
  DRAW.chair_wood = chair({ h: 24, seatZ: 7, backZ: 20, legs: '#6e4226', seat: '#c98a52', back: '#b87a45' });
  DRAW.chair_cushion = chair({ h: 24, seatZ: 7, backZ: 20, legs: '#6e4226', seat: '#a8703a', pad: '#e0605a', back: '#e0605a', backO: { left: '#c94c47', right: '#a63a37' } });
  DRAW.chair_red = chair({ h: 28, seatZ: 8, backZ: 25, legs: '#4a2a14', seat: '#7e1f26', pad: '#a8242c', back: '#a8242c', backO: { left: '#8c1d25', right: '#6a161c' } });
  DRAW.chair_gold = chair({ h: 32, seatZ: 8, backZ: 28, legs: '#c99a2e', seat: '#e8b83a', pad: '#6a3a9a', back: '#e8b83a', backO: { left: '#c99a2e', right: '#a07a1c' } });

  /* 爐灶 */
  DRAW.stove_gas = { h: 30, fn(b) {
    b.box(0.08, 0.08, 0.92, 0.92, 0, 10, '#8e979f', { top: '#b2bac1' });
    b.disc(0.5, 0.5, 10, 8, 4, '#2e2e33');
    b.disc(0.5, 0.5, 10, 5, 2, '#50505a');
    b.cyl(0.5, 0.5, 10, 17, 6, 3, '#c9ced4', '#9aa1a8');
    b.disc(0.5, 0.5, 17, 2, 1, '#6a7078');
    for (let i = 0; i < 3; i++) b.dot(0.28 + i * 0.22, 0.92, 4, '#2e2e33', 2, 2);
    b.dot(0.3, 0.5, 10, '#4aa8ff', 1, 1);
    b.dot(0.7, 0.5, 10, '#4aa8ff', 1, 1);
  } };
  DRAW.stove_wok = { h: 30, fn(b) {
    b.box(0.08, 0.08, 0.92, 0.92, 0, 10, '#4a4f56', { top: '#666c74' });
    b.box(0.08, 0.5, 0.92, 0.55, 5, 6, '#d94f43', { top: '#d94f43', left: '#d94f43', right: '#d94f43' });
    b.disc(0.5, 0.5, 10, 11, 5, '#1d1f23');
    b.disc(0.5, 0.52, 11, 9, 4, '#33373d');
    b.disc(0.5, 0.52, 11, 5, 2, '#d98a3a');
    b.dot(0.45, 0.5, 12, '#6cc15b', 2, 1);
    b.dot(0.58, 0.54, 12, '#e8e0a0', 2, 1);
    b.box(0.82, 0.44, 1.12, 0.52, 11, 12, '#2a2a30');
  } };
  DRAW.stove_steam = { h: 40, fn(b) {
    b.box(0.08, 0.08, 0.92, 0.92, 0, 10, '#b9824a', { top: '#d4a064' });
    b.cyl(0.5, 0.5, 10, 14, 11, 5, '#ecc984', '#c08e4a');
    b.cyl(0.5, 0.5, 14, 18, 11, 5, '#ecc984', '#c08e4a');
    b.cyl(0.5, 0.5, 18, 22, 11, 5, '#ecc984', '#c08e4a');
    b.disc(0.5, 0.5, 22, 8, 3, '#f4dca0');
    b.disc(0.5, 0.5, 24, 2, 1, '#8a5a2a');
    for (const z of [13, 17, 21]) b.dot(0.5, 0.5, z, '#8a5a2a', 1, 1);
  } };
  DRAW.stove_pro = { h: 48, fn(b) {
    b.box(0.04, 0.04, 0.96, 0.96, 0, 11, '#c8d0d8', { top: '#e2e8ee' });
    b.box(0.04, 0.04, 0.96, 0.96, 4, 6, '#d94f43', { top: '#d94f43' });
    b.box(0.1, 0.1, 0.9, 0.9, 11, 12, '#22252a', { top: '#2c3036' });
    b.disc(0.3, 0.5, 12, 6, 3, '#555a62');
    b.disc(0.7, 0.5, 12, 6, 3, '#555a62');
    b.cyl(0.3, 0.5, 12, 18, 5, 2, '#d8dde2', '#a6adb4');
    b.cyl(0.7, 0.5, 12, 15, 6, 3, '#2a2d33', '#1a1c20');
    for (let i = 0; i < 4; i++) b.dot(0.2 + i * 0.2, 0.96, 6, '#22252a', 2, 2);
    // 後牆板與抽油煙機
    b.box(0.04, 0.04, 0.96, 0.14, 11, 40, '#aab2ba', { top: '#cdd3d9' });
    b.box(0.04, 0.04, 0.96, 0.5, 30, 38, '#c2cad2', { top: '#dfe5ea' });
  } };

  /* 功能 */
  DRAW.register = { h: 30, fn(b) {
    b.box(0.06, 0.06, 0.94, 0.94, 0, 9, '#8a5a32', { top: '#a8723e' });
    b.box(0.2, 0.22, 0.8, 0.8, 9, 14, '#d8d0b8');
    b.box(0.28, 0.2, 0.72, 0.4, 14, 22, '#3a3f48');
    b.dot(0.5, 0.4, 19, '#6fe38a', 5, 1);
    b.dot(0.5, 0.4, 17, '#6fe38a', 3, 1);
    for (let i = 0; i < 3; i++) b.dot(0.34 + i * 0.12, 0.7, 14, '#8a7a5a', 2, 1);
    b.disc(0.82, 0.8, 9, 3, 1, '#e8b83a');
  } };
  DRAW.fridge = { h: 42, fn(b) {
    b.box(0.1, 0.1, 0.9, 0.9, 0, 34, '#e6edf1', { left: '#cdd8de', right: '#a9b7c0', top: '#f4f8fa' });
    b.wallU(0.1, 0.9, 0.9, 20, 21, '#8fa0aa');
    b.wallU(0.74, 0.78, 0.9, 6, 17, '#4a5560');
    b.wallU(0.74, 0.78, 0.9, 24, 31, '#4a5560');
    b.dot(0.3, 0.9, 28, '#d94f43', 2, 2);
    b.dot(0.4, 0.9, 12, '#e8b83a', 2, 2);
  } };

  /* 裝飾 */
  function leaf(g, x, y, w, hgt, c) {
    poly(g, [[x, y], [x + w, y - hgt / 2], [x, y - hgt], [x - w, y - hgt / 2]], c);
  }
  DRAW.plant_pot = { h: 28, fn(b) {
    b.cyl(0.5, 0.5, 0, 6, 6, 3, '#4a3322', '#b86b45');
    b.cyl(0.5, 0.5, 5, 7, 7, 3, '#4a3322', '#c97b53');
    const [cx, cy] = b.P(0.5, 0.5, 7);
    const g = b.g;
    leaf(g, cx - 5, cy, 3, 12, '#2f7d3a');
    leaf(g, cx + 5, cy, 3, 12, '#2f7d3a');
    leaf(g, cx, cy, 4, 18, '#4aa54a');
    leaf(g, cx - 3, cy, 3, 14, '#6cc15b');
    leaf(g, cx + 3, cy, 3, 15, '#3d9145');
  } };
  DRAW.lantern = { h: 46, fn(b) {
    b.cyl(0.5, 0.5, 0, 2, 5, 2, '#5a3a22', '#4a2e1a');
    b.box(0.46, 0.46, 0.54, 0.54, 2, 22, '#6b4528');
    b.cyl(0.5, 0.5, 22, 23, 4, 2, '#e8b83a', '#c99a2e');
    b.cyl(0.5, 0.5, 23, 32, 7, 4, '#ff7a55', '#d63b32');
    b.cyl(0.5, 0.5, 32, 33, 4, 2, '#e8b83a', '#c99a2e');
    const [cx, cy] = b.P(0.5, 0.5, 0);
    gfx.rect(b.g, '#f6c453', cx - 1, cy - 31, 2, 7);
    gfx.rect(b.g, '#e8b83a', cx, cy - 20, 1, 3);
  } };
  DRAW.plant_tree = { h: 56, fn(b) {
    b.cyl(0.5, 0.5, 0, 9, 8, 4, '#4a3322', '#c9613a');
    b.cyl(0.5, 0.5, 8, 10, 9, 4, '#4a3322', '#e0a35e');
    b.box(0.46, 0.46, 0.56, 0.56, 10, 24, '#6b4528');
    const [cx, cy] = b.P(0.5, 0.5, 0);
    const g = b.g;
    for (const [x, y, rx, ry, c] of [[-9, -30, 8, 6, '#2f7d3a'], [9, -31, 8, 6, '#2f7d3a'], [0, -41, 10, 7, '#3d9145'], [-4, -28, 9, 6, '#3d9145'], [6, -36, 7, 5, '#4aa54a'], [-7, -37, 6, 4, '#4aa54a']]) ellipse(g, c, cx + x, cy + y, rx, ry);
    for (const [x, y] of [[-8, -40], [4, -46], [10, -33], [-2, -34]]) ellipse(g, '#7fd06b', cx + x, cy + y, 2, 1);
    for (const [x, y] of [[-6, -31], [7, -38]]) gfx.rect(g, '#e8b83a', cx + x, cy + y, 2, 2);
  } };

  const CAT = [
    '..k........k..',
    '.kwk......kwk.',
    '.kwpkkkkkkpwk.',
    'kwwwwwwwwwwwwk',
    'kwwkkwwwwkkwwk',
    'kwwwwwppwwwwwk',
    'kwwwwwwwwwwwwk',
    '.kwwwwwwwwwwk.',
    '.krrrrYYrrrrk.',
    '..kwwwwYwwwk..',
    '.kwwwwwwwwwwk.',
    '.kwwwwwwwwwwkk',
    '.kwwwwwwwwwwwk',
    '.kwwwwwwwwwwwk',
    '.kwwwwwwwwwwk.',
    '..kkkkkkkkkk..',
  ];
  const CAT_LEGEND = { k: '#3b2a24', w: '#f7f2ea', p: '#f09aa8', r: '#d63b32', Y: '#f2c14e' };
  let catImg = null;
  DRAW.cat = { h: 36, fn(b) {
    b.box(0.22, 0.22, 0.78, 0.78, 0, 5, '#a8302a', { top: '#c4403a' });
    b.flat(0.22, 0.22, 0.78, 0.26, 5, '#e8b83a');
    catImg = catImg || gfx.pixmap(CAT, CAT_LEGEND);
    const [cx, cy] = b.P(0.5, 0.5, 5);
    b.g.drawImage(catImg, cx - 7, cy - 14);
    // 舉起的右手
    gfx.rect(b.g, '#3b2a24', cx + 6, cy - 21, 4, 8);
    gfx.rect(b.g, '#f7f2ea', cx + 7, cy - 20, 2, 7);
    gfx.rect(b.g, '#f2c14e', cx + 7, cy - 4, 3, 3);
  } };
  DRAW.screen = { h: 42, fn(b) {
    for (const u of [0.02, 1.86]) b.box(u, 0.38, u + 0.12, 0.62, 0, 30, '#5a3418');
    b.box(0.1, 0.42, 1.9, 0.58, 2, 26, '#c9a16a', { left: '#d7b27c', right: '#a8804a', top: '#e0c08a' });
    b.box(0.02, 0.38, 1.98, 0.62, 26, 30, '#6b4528');
    for (const u of [0.7, 1.3]) b.box(u - 0.02, 0.4, u + 0.02, 0.6, 2, 26, '#6b4528');
    for (let i = 0; i < 3; i++) {
      const u0 = 0.16 + i * 0.6;
      b.wallU(u0, u0 + 0.46, 0.58, 6, 22, '#e8d4a6');
      b.wallU(u0 + 0.12, u0 + 0.16, 0.58, 8, 20, '#6e9a4a');
      b.wallU(u0 + 0.26, u0 + 0.3, 0.58, 10, 20, '#6e9a4a');
      b.wallU(u0 + 0.1, u0 + 0.36, 0.58, 14, 15, '#4a7a3a');
    }
  } };
  DRAW.fishtank = { h: 40, fn(b) {
    b.box(0.05, 0.1, 0.95, 0.9, 0, 9, '#5a3a22');
    b.box(0.1, 0.15, 0.9, 0.85, 9, 27, '#bfeaf5', { left: '#6fc3e0', right: '#4aa3c8', top: '#cdf1fa' });
    b.wallU(0.12, 0.88, 0.85, 9, 13, '#e8d8a0');
    b.dot(0.3, 0.85, 14, '#2f9a4a', 2, 6);
    b.dot(0.74, 0.85, 14, '#2f9a4a', 2, 8);
    b.dot(0.42, 0.85, 20, '#ff8a3a', 4, 2);
    b.dot(0.38, 0.85, 20, '#ff8a3a', 1, 1);
    b.dot(0.6, 0.85, 17, '#ffd84a', 3, 2);
    b.dot(0.55, 0.85, 23, '#e8fbff', 1, 1);
    b.dot(0.2, 0.85, 24, '#e8fbff', 1, 1);
    b.box(0.08, 0.13, 0.92, 0.87, 27, 29, '#2f3b46');
  } };
  DRAW.jukebox = { h: 46, fn(b) {
    b.box(0.12, 0.15, 0.88, 0.85, 0, 28, '#8a2f3a', { left: '#a83a46', right: '#6a232c', top: '#c4505c' });
    b.wallU(0.2, 0.8, 0.85, 8, 25, '#ffcf5a');
    b.wallU(0.2, 0.8, 0.85, 8, 12, '#ff8a3a');
    b.wallU(0.2, 0.8, 0.85, 12, 16, '#ff5a4a');
    b.wallU(0.26, 0.74, 0.85, 17, 24, '#ffe9a0');
    b.dot(0.5, 0.85, 20, '#8a2f3a', 4, 4);
    b.dot(0.5, 0.85, 21, '#ffe9a0', 2, 2);
    for (let i = 0; i < 4; i++) b.dot(0.28 + i * 0.14, 0.85, 4, '#e8e0c8', 2, 2);
    b.disc(0.5, 0.5, 28, 9, 4, '#c4505c');
    b.wallV(0.2, 0.8, 0.88, 6, 24, '#6fe3d8');
  } };
  DRAW.statue = { h: 52, fn(b) {
    b.box(0.12, 0.12, 0.88, 0.88, 0, 9, '#a2a2aa', { top: '#c2c2ca' });
    const [cx, cy] = b.P(0.5, 0.5, 9);
    const g = b.g;
    ellipse(g, '#9c9ca5', cx - 2, cy - 7, 9, 6);
    ellipse(g, '#bcbcc6', cx - 3, cy - 9, 7, 4);
    ellipse(g, '#8c8c96', cx + 4, cy - 14, 7, 7);
    ellipse(g, '#bcbcc6', cx + 4, cy - 17, 5, 5);
    ellipse(g, '#d0d0d8', cx + 5, cy - 16, 3, 3);
    gfx.rect(g, '#e8b83a', cx + 2, cy - 19, 2, 2);
    gfx.rect(g, '#e8b83a', cx + 7, cy - 19, 2, 2);
    gfx.rect(g, '#3b2a24', cx + 5, cy - 14, 3, 1);
    gfx.rect(g, '#8c8c96', cx - 9, cy - 5, 3, 8);
    gfx.rect(g, '#8c8c96', cx + 6, cy - 4, 3, 7);
  } };
  DRAW.piano = { h: 50, fn(b) {
    b.wallU(0.1, 1.9, 0.14, 22, 37, '#15151a');
    b.box(0.08, 0.1, 0.92, 0.2, 0, 10, '#2a2a33');
    for (const u of [0.1, 0.9, 1.7]) b.box(u, 0.74, u + 0.14, 0.88, 0, 11, '#1c1c22');
    b.box(1.74, 0.1, 1.9, 0.24, 0, 10, '#2a2a33');
    b.box(0.04, 0.1, 1.96, 0.92, 11, 22, '#22222a', { top: '#3a3a46', left: '#2c2c36', right: '#14141a' });
    b.wallU(0.12, 1.88, 0.92, 15, 19, '#f4f2ea');
    for (let i = 0; i < 18; i++) b.dot(0.14 + i * 0.1, 0.92, 17, '#15151a', 1, 3);
    b.dot(0.4, 0.5, 22, '#55555f', 6, 1);
  } };

  /* ───────── 對外介面 ───────── */

  const furnCache = new Map();
  const tileCache = new Map();
  const roomCache = new Map();

  /** {c, ax, ay}：ax,ay 為「佔地左上格的頂點」在小圖中的位置 */
  function furniture(id, rot, part) {
    const def = D.furniture[id];
    const dr = DRAW[id];
    const isChair = def.cat === 'chair';
    const rr = isChair ? rot & 3 : def.rot ? rot & 3 : 0;
    const key = id + ':' + rr + ':' + (part || 'all');
    let e = furnCache.get(key);
    if (e) return e;
    const fp = RC.world.footprint(def, rr);
    const pad = 3;
    const H = dr.h + 4;
    const c = canvas((fp.w + fp.h) * 16 + pad * 2, (fp.w + fp.h) * 8 + H + pad * 2);
    const ax = fp.h * 16 + pad;
    const ay = H + pad;
    const swap = !!(rr & 1) && !isChair;
    const b = brush(ctx(c), ax, ay, swap);
    dr.fn(b, { rot: rr, face: rr, part: part || 'all', fw: fp.w, fh: fp.h });
    outline(c);
    e = { c, ax, ay };
    furnCache.set(key, e);
    return e;
  }

  function floorTile(id, alt) {
    const key = 'f:' + id + ':' + (alt ? 1 : 0);
    let t = tileCache.get(key);
    if (!t) tileCache.set(key, (t = bakeTile(FLOORS[id](!!alt))));
    return t;
  }
  const wallSegCache = new Map();
  function wallSeg(id, kind) {
    const key = id + ':' + kind;
    let c = wallSegCache.get(key);
    if (!c) wallSegCache.set(key, (c = bakeWallSeg(id, kind)));
    return c;
  }
  function roomLayer(stage, floorId, wallId) {
    const key = stage + ':' + floorId + ':' + wallId;
    let r = roomCache.get(key);
    if (!r) {
      if (roomCache.size > 6) roomCache.clear();
      roomCache.set(key, (r = bakeRoom(stage, floorId, wallId)));
    }
    return r;
  }

  RC.artWorld = { WALL_H, SLAB, furniture, floorTile, wallSeg, roomLayer, DRAW };
})(typeof globalThis !== 'undefined' ? globalThis : window);
