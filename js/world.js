/* 餐廳格子世界：佔位、擺放檢查、A* 尋路、座位與爐灶偵測。純邏輯。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});
  const { DX, DY } = RC.data;

  /** 旋轉後的佔地（奇數 rot 互換長寬） */
  function footprint(def, rot) {
    return rot & 1 ? { w: def.h, h: def.w } : { w: def.w, h: def.h };
  }

  /** 由物件清單建立格子。blocked=不可行走；occ=該格上的物件。 */
  function buildGrid(items, w, h, doorY) {
    const occ = new Array(w * h).fill(null);
    const blocked = new Uint8Array(w * h);
    for (const it of items) {
      const def = RC.data.furniture[it.id];
      if (!def) continue;
      const fp = footprint(def, it.rot);
      for (let dy = 0; dy < fp.h; dy++) {
        for (let dx = 0; dx < fp.w; dx++) {
          const x = it.x + dx;
          const y = it.y + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          occ[y * w + x] = it;
          blocked[y * w + x] = 1;
        }
      }
    }
    const grid = { w, h, occ, blocked, door: { x: 0, y: doorY }, items, reach: null };
    grid.reach = floodFrom(grid, 0, doorY);
    return grid;
  }

  const inBounds = (g, x, y) => x >= 0 && y >= 0 && x < g.w && y < g.h;
  const walkable = (g, x, y) => inBounds(g, x, y) && !g.blocked[y * g.w + x];
  const itemAt = (g, x, y) => (inBounds(g, x, y) ? g.occ[y * g.w + x] : null);

  /** 由起點走得到的所有格子（BFS）。 */
  function floodFrom(g, sx, sy) {
    const seen = new Uint8Array(g.w * g.h);
    if (!walkable(g, sx, sy)) return seen;
    const q = [[sx, sy]];
    seen[sy * g.w + sx] = 1;
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        if (walkable(g, nx, ny) && !seen[ny * g.w + nx]) {
          seen[ny * g.w + nx] = 1;
          q.push([nx, ny]);
        }
      }
    }
    return seen;
  }

  /** 能不能把 def 以 rot 放在 (x,y)？ignoreUid 用於「移動」時忽略自己。 */
  function canPlace(g, def, x, y, rot, ignoreUid) {
    const fp = footprint(def, rot);
    if (x < 0 || y < 0 || x + fp.w > g.w || y + fp.h > g.h) return { ok: false, reason: '超出餐廳範圍' };
    for (let dy = 0; dy < fp.h; dy++) {
      for (let dx = 0; dx < fp.w; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        const o = g.occ[ty * g.w + tx];
        if (o && o.uid !== ignoreUid) return { ok: false, reason: '這裡已經有東西了' };
        if (ty === g.door.y && tx <= 1) return { ok: false, reason: '門口要保持暢通' };
      }
    }
    return { ok: true };
  }

  /* ── A* ── */
  class Heap {
    constructor() {
      this.a = [];
    }
    get size() {
      return this.a.length;
    }
    push(node) {
      const a = this.a;
      a.push(node);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].f <= a[i].f) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    }
    pop() {
      const a = this.a;
      const top = a[0];
      const last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < a.length && a[l].f < a[m].f) m = l;
          if (r < a.length && a[r].f < a[m].f) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]];
          i = m;
        }
      }
      return top;
    }
  }

  /**
   * 四向 A*。起點與終點即使被擋也允許（椅子、爐灶旁站位等情境）。
   * 回傳不含起點的格子陣列 [{x,y}...]；找不到回傳 null；已在原地回傳 []。
   */
  function findPath(g, sx, sy, tx, ty) {
    if (!inBounds(g, sx, sy) || !inBounds(g, tx, ty)) return null;
    if (sx === tx && sy === ty) return [];
    const W = g.w;
    const gScore = new Float32Array(g.w * g.h).fill(Infinity);
    const from = new Int32Array(g.w * g.h).fill(-1);
    const closed = new Uint8Array(g.w * g.h);
    const open = new Heap();
    const hf = (x, y) => Math.abs(x - tx) + Math.abs(y - ty);
    gScore[sy * W + sx] = 0;
    open.push({ x: sx, y: sy, f: hf(sx, sy) });
    while (open.size) {
      const cur = open.pop();
      const ci = cur.y * W + cur.x;
      if (closed[ci]) continue;
      closed[ci] = 1;
      if (cur.x === tx && cur.y === ty) {
        const path = [];
        let i = ci;
        while (i !== sy * W + sx) {
          path.push({ x: i % W, y: (i / W) | 0 });
          i = from[i];
        }
        return path.reverse();
      }
      for (let d = 0; d < 4; d++) {
        const nx = cur.x + DX[d];
        const ny = cur.y + DY[d];
        if (!inBounds(g, nx, ny)) continue;
        const ni = ny * W + nx;
        if (closed[ni]) continue;
        const isGoal = nx === tx && ny === ty;
        if (g.blocked[ni] && !isGoal) continue;
        const ng = gScore[ci] + 1;
        if (ng < gScore[ni]) {
          gScore[ni] = ng;
          from[ni] = ci;
          open.push({ x: nx, y: ny, f: ng + hf(nx, ny) });
        }
      }
    }
    return null;
  }

  /** 找離 (sx,sy) 路徑最短的候選格；回傳 {tile, path} 或 null。 */
  function nearestReachable(g, sx, sy, tiles) {
    let best = null;
    for (const t of tiles) {
      const p = findPath(g, sx, sy, t.x, t.y);
      if (p && (!best || p.length < best.path.length)) best = { tile: t, path: p };
    }
    return best;
  }

  /** 找出所有可用座位：椅子 + 相鄰的桌子 + 可走到的入座側。 */
  function findSeats(g) {
    const seats = [];
    const F = RC.data.furniture;
    for (const it of g.items) {
      const def = F[it.id];
      if (!def || def.cat !== 'chair') continue;
      let face = -1;
      let table = null;
      for (let k = 0; k < 4 && face < 0; k++) {
        const d = (it.rot + k) & 3; // 優先面向設定的方向
        const o = itemAt(g, it.x + DX[d], it.y + DY[d]);
        if (o && F[o.id].cat === 'table') {
          face = d;
          table = o;
        }
      }
      if (face < 0) continue;
      const access = [];
      for (let d = 0; d < 4; d++) {
        const nx = it.x + DX[d];
        const ny = it.y + DY[d];
        if (walkable(g, nx, ny) && g.reach[ny * g.w + nx]) access.push({ x: nx, y: ny });
      }
      if (!access.length) continue;
      seats.push({
        uid: it.uid,
        x: it.x,
        y: it.y,
        face,
        tableUid: table.uid,
        tx: it.x + DX[face],
        ty: it.y + DY[face],
        access,
      });
    }
    return seats;
  }

  /** 家具有「正面」要朝向走道的（收銀機、冰箱、點唱機）：裝潢時自動轉向、上視圖畫箭頭 */
  const hasFront = (def) => !!(def && def.front);
  /** 會顯示方向的家具：椅子（面向桌子）與有正面的家具 */
  const isOriented = (def) => !!(def && (def.cat === 'chair' || def.front));

  /**
   * 建議的朝向（0 右、1 下、2 左、3 上）：
   * - 椅子：面向緊鄰的桌子（目前的方向已經面向桌子就不動；兩邊都有桌子，維持玩家選的那一邊）。旁邊沒有桌子就維持原樣。
   * - 有正面的家具：正面朝向走道（相鄰的空格）；目前的方向就是空格就不動，否則選最靠近房間中央的空格。
   * 其他家具不需要方向，回傳原本的 rot。uid：移動中的家具自己（不算障礙）。
   */
  function suggestRot(g, def, x, y, rot, uid) {
    rot &= 3;
    if (def.cat === 'chair') {
      for (let k = 0; k < 4; k++) {
        const d = (rot + k) & 3;
        const o = itemAt(g, x + DX[d], y + DY[d]);
        if (o && o.uid !== uid && RC.data.furniture[o.id].cat === 'table') return d;
      }
      return rot;
    }
    if (!hasFront(def)) return rot;
    const open = (d) => {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (!inBounds(g, nx, ny)) return false;
      const o = itemAt(g, nx, ny);
      return walkable(g, nx, ny) || !!(o && o.uid === uid); // 走得到的空格（移動中的家具原本的位置也算空）
    };
    if (open(rot)) return rot;
    let best = -1;
    let bestDist = Infinity;
    for (let k = 1; k < 4; k++) {
      const d = (rot + k) & 3;
      if (!open(d)) continue;
      const dist = Math.hypot(x + DX[d] - (g.w - 1) / 2, y + DY[d] - (g.h - 1) / 2);
      if (dist < bestDist - 1e-9) {
        best = d;
        bestDist = dist;
      }
    }
    return best < 0 ? rot : best;
  }

  /** 找出所有爐灶與可站的位置。 */
  function findStoves(g) {
    const stoves = [];
    const F = RC.data.furniture;
    for (const it of g.items) {
      const def = F[it.id];
      if (!def || def.cat !== 'stove') continue;
      const fp = footprint(def, it.rot);
      const access = [];
      for (let dy = 0; dy < fp.h; dy++) {
        for (let dx = 0; dx < fp.w; dx++) {
          for (let d = 0; d < 4; d++) {
            const nx = it.x + dx + DX[d];
            const ny = it.y + dy + DY[d];
            if (walkable(g, nx, ny) && g.reach[ny * g.w + nx] && !access.some((a) => a.x === nx && a.y === ny)) access.push({ x: nx, y: ny });
          }
        }
      }
      if (access.length) stoves.push({ uid: it.uid, id: it.id, x: it.x, y: it.y, speed: def.speed || 1, tier: def.tier || 0, access });
    }
    return stoves;
  }

  /** 找出所有洗碗槽與可站的位置。 */
  function findSinks(g) {
    const sinks = [];
    const F = RC.data.furniture;
    for (const it of g.items) {
      const def = F[it.id];
      if (!def || def.fn !== 'sink') continue;
      const access = [];
      for (let d = 0; d < 4; d++) {
        const nx = it.x + DX[d];
        const ny = it.y + DY[d];
        if (walkable(g, nx, ny) && g.reach[ny * g.w + nx]) access.push({ x: nx, y: ny });
      }
      if (access.length) sinks.push({ uid: it.uid, id: it.id, x: it.x, y: it.y, access });
    }
    return sinks;
  }

  /** 距離 (x,y) 最近的可行走格（BFS），用於把被家具壓到的人移開。 */
  function nearestWalkable(g, x, y) {
    x = Math.max(0, Math.min(g.w - 1, x));
    y = Math.max(0, Math.min(g.h - 1, y));
    const seen = new Uint8Array(g.w * g.h);
    const q = [[x, y]];
    seen[y * g.w + x] = 1;
    for (let i = 0; i < q.length; i++) {
      const [cx, cy] = q[i];
      if (walkable(g, cx, cy)) return { x: cx, y: cy };
      for (let d = 0; d < 4; d++) {
        const nx = cx + DX[d];
        const ny = cy + DY[d];
        if (inBounds(g, nx, ny) && !seen[ny * g.w + nx]) {
          seen[ny * g.w + nx] = 1;
          q.push([nx, ny]);
        }
      }
    }
    return { x: g.door.x, y: g.door.y };
  }

  RC.world = { footprint, buildGrid, inBounds, walkable, itemAt, floodFrom, canPlace, findPath, nearestReachable, findSeats, hasFront, isOriented, suggestRot, findStoves, findSinks, nearestWalkable };
})(typeof globalThis !== 'undefined' ? globalThis : window);
