/* 像素繪圖基礎：無鋸齒填色、等角方塊、描邊、字串像素圖、點陣數字字型。僅瀏覽器。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});

  const OUTLINE = '#2b1d1a';

  /** 預設為 CPU 畫布（素材要讀像素做描邊）；gpu=true 用於每幀重畫的大畫布。 */
  function canvas(w, h, gpu) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    const g = c.getContext('2d', gpu ? undefined : { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    return c;
  }
  const ctx = (c) => c.getContext('2d');

  /* ── 顏色 ── */
  const cache = new Map();
  function rgb(hex) {
    let v = cache.get(hex);
    if (!v) {
      const n = parseInt(hex.slice(1), 16);
      v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      cache.set(hex, v);
    }
    return v;
  }
  const toHex = (r, g, b) => '#' + ((1 << 24) | (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)).toString(16).slice(1);
  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  /** f<1 變暗、f>1 變亮（乘算） */
  function shade(hex, f) {
    const [r, g, b] = rgb(hex);
    return toHex(r * f, g * f, b * f);
  }
  function mix(a, b, t) {
    const x = rgb(a);
    const y = rgb(b);
    return toHex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
  }

  /* ── 基本形狀（全部是硬邊、無抗鋸齒） ── */
  function rect(g, c, x, y, w, h) {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  }

  /** 凸多邊形掃描線填色，取像素中心判定，鄰接多邊形不會留縫。 */
  function poly(g, pts, color) {
    g.fillStyle = color;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const y0 = Math.ceil(minY - 0.5);
    const y1 = Math.floor(maxY - 0.5);
    const n = pts.length;
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      let xl = Infinity;
      let xr = -Infinity;
      for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];
        if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) {
          const x = a[0] + ((yc - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
          if (x < xl) xl = x;
          if (x > xr) xr = x;
        }
      }
      if (xr > xl) {
        const L = Math.round(xl);
        const R = Math.round(xr);
        if (R > L) g.fillRect(L, y, R - L, 1);
      }
    }
  }

  /** 像素橢圓（中心 cx,cy；半徑 rx,ry） */
  function ellipse(g, color, cx, cy, rx, ry) {
    g.fillStyle = color;
    for (let y = -ry; y < ry; y++) {
      const yc = y + 0.5;
      const w = rx * Math.sqrt(Math.max(0, 1 - (yc * yc) / (ry * ry)));
      const L = Math.round(cx - w);
      const R = Math.round(cx + w);
      if (R > L) g.fillRect(L, cy + y, R - L, 1);
    }
  }

  /* ── 等角投影：一格 32×16，u 往右下、v 往左下，z 為像素高度 ── */
  function brush(g, ax, ay, swap) {
    const P = swap ? (u, v, z) => [ax + (v - u) * 16, ay + (u + v) * 8 - z] : (u, v, z) => [ax + (u - v) * 16, ay + (u + v) * 8 - z];
    const b = {
      g,
      P,
      /** 方塊。o={top,left,right} 可覆寫各面顏色 */
      box(u0, v0, u1, v1, z0, z1, col, o) {
        o = o || {};
        if (swap) {
          [u0, v0, u1, v1] = [v0, u0, v1, u1];
          o = { top: o.top, left: o.right, right: o.left };
        }
        const pp = (u, v, z) => [ax + (u - v) * 16, ay + (u + v) * 8 - z];
        const left = o.left || shade(col, 0.82);
        const right = o.right || shade(col, 0.64);
        if (z1 > z0) {
          poly(g, [pp(u0, v1, z1), pp(u1, v1, z1), pp(u1, v1, z0), pp(u0, v1, z0)], left);
          poly(g, [pp(u1, v0, z1), pp(u1, v1, z1), pp(u1, v1, z0), pp(u1, v0, z0)], right);
        }
        poly(g, [pp(u0, v0, z1), pp(u1, v0, z1), pp(u1, v1, z1), pp(u0, v1, z1)], o.top || col);
      },
      /** 平貼在 z 高度的四邊形（u,v 範圍） */
      flat(u0, v0, u1, v1, z, col) {
        poly(g, [P(u0, v0, z), P(u1, v0, z), P(u1, v1, z), P(u0, v1, z)], col);
      },
      /** 直立面：沿 u 方向、固定 v（面向左下） */
      wallU(u0, u1, v, z0, z1, col) {
        poly(g, [P(u0, v, z1), P(u1, v, z1), P(u1, v, z0), P(u0, v, z0)], col);
      },
      /** 直立面：沿 v 方向、固定 u（面向右下） */
      wallV(v0, v1, u, z0, z1, col) {
        poly(g, [P(u, v0, z1), P(u, v1, z1), P(u, v1, z0), P(u, v0, z0)], col);
      },
      /** 以投影點為中心的圓柱（螢幕空間橢圓堆疊） */
      cyl(u, v, z0, z1, rx, ry, top, side) {
        const [cx, cy] = P(u, v, 0);
        for (let z = z0; z < z1; z++) ellipse(g, side, cx, cy - z, rx, ry);
        ellipse(g, top, cx, cy - z1, rx, ry);
      },
      disc(u, v, z, rx, ry, col) {
        const [cx, cy] = P(u, v, z);
        ellipse(g, col, cx, cy, rx, ry);
      },
      /** 以錨點為原點的原始像素 */
      px(x, y, c) {
        g.fillStyle = c;
        g.fillRect(ax + x, ay + y, 1, 1);
      },
      rect(x, y, w, h, c) {
        g.fillStyle = c;
        g.fillRect(ax + x, ay + y, w, h);
      },
      /** 在 u,v,z 位置畫一個像素 */
      dot(u, v, z, c, w, h) {
        const p = P(u, v, z);
        g.fillStyle = c;
        g.fillRect(p[0], p[1], w || 1, h || 1);
      },
    };
    return b;
  }

  /** 替不透明像素外圍加 1px 描邊（畫布需預留邊距） */
  function outline(c, color) {
    color = color || OUTLINE;
    const g = ctx(c);
    const { width: w, height: h } = c;
    const img = g.getImageData(0, 0, w, h);
    const d = img.data;
    const [r, gg, b] = rgb(color);
    const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 40;
    const mark = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 40) continue;
        if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) mark.push((y * w + x) * 4);
      }
    for (const i of mark) {
      d[i] = r;
      d[i + 1] = gg;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  /** 以 destination-in 將畫布裁成菱形（地板格用） */
  function maskDiamond(c) {
    const m = canvas(c.width, c.height);
    poly(ctx(m), [[c.width / 2, 0], [c.width, c.height / 2], [c.width / 2, c.height], [0, c.height / 2]], '#000');
    const g = ctx(c);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(m, 0, 0);
    g.globalCompositeOperation = 'source-over';
    return c;
  }

  /** 字串像素圖 → canvas。legend: {字元: '#hex'}，'.' 與空白為透明。 */
  function pixmap(rows, legend, scale) {
    const h = rows.length;
    const w = Math.max(...rows.map((r) => r.length));
    const c = canvas(w, h);
    const g = ctx(c);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        const col = legend[ch];
        if (col) {
          g.fillStyle = col;
          g.fillRect(x, y, 1, 1);
        }
      }
    if (scale && scale > 1) {
      const s = canvas(w * scale, h * scale);
      ctx(s).drawImage(c, 0, 0, w * scale, h * scale);
      return s;
    }
    return c;
  }

  /** 決定性雜訊 0..1 */
  function hash(x, y, s) {
    let h = (x * 374761393 + y * 668265263 + (s || 0) * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* ── 3×5 點陣字型（畫布上的飄字/數字用，不需要任何字型檔） ── */
  const GLYPHS = {
    0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
    5: '111100111001111', 6: '111100111101111', 7: '111001001010010', 8: '111101111101111', 9: '111101111001111',
    '+': '000010111010000', '-': '000000111000000', x: '000101010101000', ':': '000010000010000', '.': '000000000000010',
    '!': '010010010000010', '%': '101001010100101', K: '101101110101101', M: '101111111101101',
  };
  function textWidth(str) {
    return str.length * 4 - 1;
  }
  /** 在 (x,y) 畫 3×5 字型，附 1px 描邊 */
  function text(g, str, x, y, color, edge) {
    const draw = (ox, oy, col) => {
      g.fillStyle = col;
      for (let i = 0; i < str.length; i++) {
        const gl = GLYPHS[str[i]];
        if (!gl) continue;
        for (let k = 0; k < 15; k++) if (gl[k] === '1') g.fillRect(x + ox + i * 4 + (k % 3), y + oy + ((k / 3) | 0), 1, 1);
      }
    };
    if (edge !== null) {
      const e = edge || OUTLINE;
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) draw(ox, oy, e);
    }
    draw(0, 0, color);
  }

  RC.gfx = { OUTLINE, canvas, ctx, rgb, shade, mix, rect, poly, ellipse, brush, outline, maskDiamond, pixmap, hash, text, textWidth };
})(typeof globalThis !== 'undefined' ? globalThis : window);
