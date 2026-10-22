/* 上視圖（俯視）美術：裝潢模式用。每格 T×T 像素，家具以簡化的像素俯視圖表示，方便對齊格子安排桌椅。僅瀏覽器。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});
  const gfx = RC.gfx;
  const D = RC.data;
  const AW = RC.artWorld;
  const { canvas, ctx, OUTLINE, shade } = gfx;

  const T = 16; // 每格像素
  const WALL = 6; // 牆的厚度

  const R = (g, c, x, y, w, h) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  /** 外框 1px 的方塊 */
  const box = (g, x, y, w, h, fill, edge) => {
    R(g, edge || OUTLINE, x, y, w, h);
    R(g, fill, x + 1, y + 1, w - 2, h - 2);
  };
  /** 外框 1px 的圓（硬邊） */
  const disc = (g, cx, cy, r, fill, edge) => {
    gfx.ellipse(g, edge || OUTLINE, cx, cy, r, r);
    gfx.ellipse(g, fill, cx, cy, r - 1, r - 1);
  };

  /** d：0 右、1 下、2 左、3 上（與 data.js 的 DX/DY 一致）。回傳 (w,h) 的方塊上靠 d 那一側、厚 t 的長條 */
  function side(d, w, h, t) {
    if (d === 0) return [w - t, 0, t, h];
    if (d === 1) return [0, h - t, w, t];
    if (d === 2) return [0, 0, t, h];
    return [0, 0, w, t];
  }

  /* ── 各家具的俯視圖。w,h 為像素大小（含旋轉後）、f 為朝向（椅子面向桌子、其他是「正面」） ── */
  const TOP = {
    table_wood: (g, w, h) => box(g, 1, 1, w - 2, h - 2, '#b8793f', '#6b3f1d'),
    table_round: (g, w, h) => {
      disc(g, w / 2, h / 2, Math.min(w, h) / 2 - 1, '#f6f1e4', '#a89a7c');
      gfx.ellipse(g, '#e3d9c3', w / 2, h / 2, Math.min(w, h) / 2 - 4, Math.min(w, h) / 2 - 4);
    },
    table_long: (g, w, h) => {
      box(g, 1, 1, w - 2, h - 2, '#a9703a', '#6b3f1d');
      R(g, '#c58a50', 3, 3, w - 6, 2);
    },
    table_red: (g, w, h) => {
      box(g, 1, 1, w - 2, h - 2, '#a52f27', '#5a1410');
      R(g, '#d9a441', 3, 3, w - 6, 1);
      R(g, '#d9a441', 3, h - 4, w - 6, 1);
    },
    table_marble: (g, w, h) => {
      box(g, 1, 1, w - 2, h - 2, '#e9e9ef', '#8a90a0');
      R(g, '#c9ccd8', 4, 5, 6, 1);
      R(g, '#c9ccd8', 7, 9, 5, 1);
    },
    chair_stool: (g, w, h) => disc(g, w / 2, h / 2, 5, '#d79a5c', '#6b3f1d'),
    chair_wood: (g, w, h, f) => chair(g, w, h, f, '#a8703a', '#6b3f1d'),
    chair_cushion: (g, w, h, f) => chair(g, w, h, f, '#e48a98', '#7a3a46'),
    chair_red: (g, w, h, f) => chair(g, w, h, f, '#b02030', '#4a0c14'),
    chair_gold: (g, w, h, f) => chair(g, w, h, f, '#e8c040', '#7a5a10', true),
    stove_gas: (g, w, h) => {
      box(g, 1, 1, w - 2, h - 2, '#59606b', OUTLINE);
      disc(g, 5, 5, 2, '#2b2f36', '#2b2f36');
      disc(g, 11, 5, 2, '#2b2f36', '#2b2f36');
      R(g, '#e8863a', 4, 11, 8, 2);
    },
    stove_wok: (g, w, h) => {
      box(g, 1, 1, w - 2, h - 2, '#4a4f58', OUTLINE);
      disc(g, 8, 8, 5, '#23262c', '#8a8f99');
      gfx.ellipse(g, '#e8863a', 8, 8, 2, 2);
    },
    stove_steam: (g, w, h) => {
      box(g, 1, 1, w - 2, h - 2, '#6d5a48', OUTLINE);
      disc(g, 8, 8, 5, '#d9b878', '#7a5a2a');
      gfx.ellipse(g, '#efd9a4', 8, 8, 3, 3);
    },
    stove_pro: (g, w, h) => {
      box(g, 1, 1, w - 2, h - 2, '#aab3bd', OUTLINE);
      for (const [x, y] of [[5, 5], [11, 5], [5, 11], [11, 11]]) disc(g, x, y, 2, '#2b2f36', '#2b2f36');
    },
    register: (g, w, h, f) => {
      box(g, 1, 3, w - 2, h - 5, '#bfc7d0', OUTLINE);
      const [x, y, sw, sh] = side(f, w, h, 4);
      R(g, '#4a82c8', x + 2, y + 2, Math.max(2, sw - 4), Math.max(2, sh - 4));
    },
    sink: (g, w, h) => {
      box(g, 1, 1, w - 2, h - 2, '#b4bec6', OUTLINE);
      box(g, 3, 4, w - 6, h - 7, '#8fcfee', '#5a7a8c');
      R(g, '#6a747c', w / 2 - 1, 2, 2, 2);
    },
    fridge: (g, w, h, f) => {
      box(g, 1, 1, w - 2, h - 2, '#eef2f6', OUTLINE);
      const [x, y, sw, sh] = side(f, w, h, 3);
      R(g, '#9aa4ae', x + (f === 0 ? 0 : 3), y + (f === 1 ? 0 : 3), f & 1 ? sw - 6 : sw, f & 1 ? sh : sh - 6);
    },
    fridge_big: (g, w, h, f) => {
      box(g, 1, 1, w - 2, h - 2, '#d3dbe1', OUTLINE);
      const [x, y, sw, sh] = side(f, w, h, 3);
      R(g, '#7a8894', x + (f === 0 ? 0 : 3), y + (f === 1 ? 0 : 3), f & 1 ? sw - 6 : sw, f & 1 ? sh : sh - 6);
      if (f & 1) R(g, '#7a8894', 7, 2, 2, h - 4); // 門縫
      else R(g, '#7a8894', 2, 7, w - 4, 2);
    },
    freezer: (g, w, h, f) => {
      box(g, 1, 1, w - 2, h - 2, '#bcd8ea', OUTLINE);
      R(g, '#e4f2fa', 3, 3, w - 6, h - 6);
      const [x, y, sw, sh] = side(f, w, h, 3);
      R(g, '#3a5a74', x + (f === 0 ? 0 : 3), y + (f === 1 ? 0 : 3), f & 1 ? sw - 6 : sw, f & 1 ? sh : sh - 6);
    },
    plant_pot: (g, w, h) => {
      disc(g, w / 2, h / 2, 5, '#c26a3a', '#5a2a12');
      disc(g, w / 2, h / 2, 4, '#4f9e45', '#2f6a2a');
    },
    lantern: (g, w, h) => {
      disc(g, w / 2, h / 2, 5, '#d9382a', '#5a1410');
      R(g, '#f2c94c', w / 2 - 1, h / 2 - 1, 2, 2);
    },
    plant_tree: (g, w, h) => {
      disc(g, w / 2, h / 2, 7, '#3f8a3a', '#1f4a1c');
      disc(g, w / 2 - 2, h / 2 - 2, 3, '#5fb255', '#3f8a3a');
      disc(g, w / 2 + 2, h / 2 + 2, 2, '#5fb255', '#3f8a3a');
    },
    cat: (g, w, h) => {
      disc(g, w / 2, h / 2 + 1, 5, '#f4efe4', '#6a5a46');
      R(g, '#f4efe4', 4, 2, 2, 3);
      R(g, '#f4efe4', 10, 2, 2, 3);
      R(g, '#2b1d1a', 6, 7, 1, 1);
      R(g, '#2b1d1a', 9, 7, 1, 1);
      R(g, '#d9382a', 7, 10, 2, 1);
    },
    screen: (g, w, h) => {
      box(g, 1, 3, w - 2, h - 6, '#8a5a30', OUTLINE);
      const horiz = w >= h;
      for (let i = 4; i < (horiz ? w : h) - 4; i += 5) {
        if (horiz) R(g, '#c9a26a', i, 5, 2, h - 10);
        else R(g, '#c9a26a', 5, i, w - 10, 2);
      }
    },
    fishtank: (g, w, h) => {
      box(g, 1, 1, w - 2, h - 2, '#6cc0e8', '#2a5a78');
      R(g, '#f28a30', 4, 6, 3, 2);
      R(g, '#f2c94c', 9, 9, 3, 2);
    },
    jukebox: (g, w, h, f) => {
      box(g, 1, 1, w - 2, h - 2, '#7a4aa0', OUTLINE);
      const [x, y, sw, sh] = side(f, w, h, 4);
      R(g, '#f2c94c', x + 1, y + 1, Math.max(2, sw - 2), Math.max(2, sh - 2));
    },
    statue: (g, w, h) => {
      box(g, 2, 2, w - 4, h - 4, '#a9a8a2', OUTLINE);
      disc(g, w / 2, h / 2, 3, '#cfcec8', '#7a7972');
    },
    piano: (g, w, h, f) => {
      box(g, 1, 1, w - 2, h - 2, '#24262c', OUTLINE);
      const [x, y, sw, sh] = side(f, w, h, 4);
      R(g, '#f4f2ea', x + 1, y + 1, Math.max(2, sw - 2), Math.max(2, sh - 2));
    },
  };

  function chair(g, w, h, f, seat, edge, gold) {
    box(g, 2, 2, w - 4, h - 4, seat, edge);
    const [x, y, sw, sh] = side((f + 2) & 3, w, h, 4); // 椅背在遠離桌子的那一側
    R(g, edge, x + (f & 1 ? 1 : 0), y + (f & 1 ? 0 : 1), f & 1 ? sw - 2 : sw, f & 1 ? sh : sh - 2);
    if (gold) R(g, '#fff0a0', 6, 6, 4, 4);
  }

  const cache = new Map();
  /** 家具的俯視圖：{c, w, h}（像素）。rot 為佔地旋轉；椅子的 face 是面向的方向 */
  function furniture(id, rot, face) {
    const def = D.furniture[id];
    const fp = RC.world.footprint(def, rot);
    const f = (def.cat === 'chair' ? face : rot) & 3;
    const key = id + ':' + (rot & 3) + ':' + f;
    let e = cache.get(key);
    if (e) return e;
    const w = fp.w * T;
    const h = fp.h * T;
    const c = canvas(w, h);
    const draw = TOP[id];
    if (draw) draw(ctx(c), w, h, f);
    else box(ctx(c), 1, 1, w - 2, h - 2, '#999', OUTLINE);
    e = { c, w, h };
    cache.set(key, e);
    return e;
  }

  /** 取地板／牆壁素材中間的顏色當作上視圖的底色 */
  function sampleColor(c, x, y) {
    const d = ctx(c).getImageData(x, y, 1, 1).data;
    return '#' + ((1 << 24) | (d[0] << 16) | (d[1] << 8) | d[2]).toString(16).slice(1);
  }
  const colorCache = new Map();
  function floorColors(id) {
    let v = colorCache.get('f' + id);
    if (!v) {
      const a = AW.floorTile(id, false);
      const b = AW.floorTile(id, true);
      v = [sampleColor(a, a.width >> 1, a.height >> 1), sampleColor(b, b.width >> 1, b.height >> 1)];
      colorCache.set('f' + id, v);
    }
    return v;
  }
  function wallColor(id) {
    let v = colorCache.get('w' + id);
    if (!v) {
      const seg = AW.wallSeg(id, 'plain');
      v = sampleColor(seg, seg.width >> 1, Math.min(seg.height - 4, 24));
      colorCache.set('w' + id, v);
    }
    return v;
  }

  const roomCache = new Map();
  /**
   * 房間的上視圖底圖：地板（兩色格子）、上方與左側的牆（有窗戶）、左牆上的入口。
   * 回傳 {c, ox, oy}：ox,oy 是格 (0,0) 左上角在圖中的位置。
   */
  function room(stage, floorId, wallId) {
    const key = stage + ':' + floorId + ':' + wallId;
    let r = roomCache.get(key);
    if (r) return r;
    if (roomCache.size > 6) roomCache.clear();
    const exp = D.expansions[stage];
    const w = exp.w;
    const h = exp.h;
    const B = WALL;
    const c = canvas(w * T + B * 2, h * T + B * 2);
    const g = ctx(c);
    const [fa, fb] = floorColors(floorId);
    const wc = wallColor(wallId);
    // 地板
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) R(g, (x + y) & 1 ? fb : fa, B + x * T, B + y * T, T, T);
    // 牆：上方與左側（和等角視圖裡看得到的兩面牆一致）
    R(g, OUTLINE, 0, 0, w * T + B * 2, B);
    R(g, OUTLINE, 0, 0, B, h * T + B * 2);
    R(g, wc, 1, 1, w * T + B * 2 - 2, B - 2);
    R(g, wc, 1, 1, B - 2, h * T + B * 2 - 2);
    R(g, shade(wc, 0.8), 1, B - 2, w * T + B * 2 - 2, 1);
    R(g, shade(wc, 0.8), B - 2, 1, 1, h * T + B * 2 - 2);
    // 窗戶
    for (let x = 1; x < w; x += 3) R(g, '#9ed4f0', B + x * T + 2, 1, T - 4, B - 3);
    for (let y = 0; y < h; y += 3) if (y !== D.DOOR_Y) R(g, '#9ed4f0', 1, B + y * T + 2, B - 3, T - 4);
    // 入口（左牆）
    R(g, '#6b3f1d', 0, B + D.DOOR_Y * T, B, T);
    R(g, '#e8d29a', 1, B + D.DOOR_Y * T + 1, B - 2, T - 2);
    // 其餘兩邊（下、右）是敞開的邊緣
    R(g, OUTLINE, B, h * T + B, w * T + B, 1);
    R(g, OUTLINE, w * T + B, B, 1, h * T);
    r = { c, ox: B, oy: B, w: w * T + B * 2, h: h * T + B * 2 };
    roomCache.set(key, r);
    return r;
  }

  /**
   * 方向箭頭（5×5 像素的小三角形，帶深色外框），畫在 (cx, cy) 為中心、指向 d（0 右、1 下、2 左、3 上）。
   * 椅子：指向桌子（客人面對的方向）；有正面的家具：指向正面（走道）。
   */
  const ARROW = [[0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [1, -1], [1, 0], [1, 1], [2, 0]]; // 指向右的三角形（相對座標）
  const rotPt = ([x, y], d) => (d === 0 ? [x, y] : d === 1 ? [-y, x] : d === 2 ? [-x, -y] : [y, -x]);
  function arrow(g, cx, cy, d, fill, edge) {
    const pts = ARROW.map((p) => rotPt(p, d & 3));
    g.fillStyle = edge || '#3b2a20';
    for (const [x, y] of pts) g.fillRect(cx + x - 1, cy + y - 1, 3, 3);
    g.fillStyle = fill || '#fff4a8';
    for (const [x, y] of pts) g.fillRect(cx + x, cy + y, 1, 1);
  }

  RC.artTop = { T, WALL, furniture, room, arrow };
})(typeof globalThis !== 'undefined' ? globalThis : window);
