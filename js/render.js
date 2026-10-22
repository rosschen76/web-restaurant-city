/* 繪圖層：把 Game 的狀態畫到 Canvas。以低解析度緩衝繪製再整數倍放大，保持像素銳利。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});
  const gfx = RC.gfx;
  const D = RC.data;
  const A = RC.artWorld;
  const AP = RC.artPeople;
  const AT = RC.artTop;
  const { canvas, ctx } = gfx;

  const SEATED = ['browse', 'wait_order', 'ordering', 'wait_food', 'eat', 'wait_pay'];
  const TOP_UI = 64; // css px，HUD 保留空間
  const BOTTOM_UI = 92;

  class Renderer {
    constructor(el, game) {
      this.el = el;
      this.g = el.getContext('2d');
      this.game = game;
      this.low = canvas(320, 200, true);
      this.lg = ctx(this.low);
      this.S = 3;
      this.dpr = 1;
      this.time = 0;
      this.top = false; // 上視圖（裝潢模式用）
      this._edit = false;
      this.ghost = null; // {id, rot, tx, ty, ok}
      this.selectedItem = null; // uid
      this.selectedActor = null; // {kind:'staff'|'customer', id}
      this.floaters = [];
      this.particles = [];
      this.stoveTimer = 0;
      this.frameDt = 0;
      this.bindGame();
      this.resize();
      this._ready = true;
    }

    /** 裝潢模式：視角改成上視圖（俯視），方便對齊格子安排桌椅；離開後恢復等角視圖 */
    get edit() {
      return this._edit;
    }
    set edit(on) {
      on = !!on;
      if (on === this._edit) return;
      this._edit = on;
      this.top = on;
      if (this._ready) this.layout();
    }

    bindGame() {
      const g = this.game;
      g.on('coins', (e) => {
        const p = this.proj(e.x, e.y);
        this.floaters.push({ x: p[0], y: p[1] - 22, text: (e.n >= 0 ? '+' : '') + RC.util.fmt(Math.abs(e.n)), life: 1.1, t: 0, coin: true });
        if (!e.silent) this.burst(p[0], p[1] - 14, 6);
      });
      g.on('drop', (e) => {
        const p = this.proj(e.x, e.y);
        this.sparkle(p[0], p[1] - 18, 3);
      });
      g.on('cooked', (e) => {
        const p = this.proj(e.x, e.y);
        this.puff(p[0], p[1] - 16, 4);
      });
      g.on('delivered', (e) => {
        const p = this.proj(e.x, e.y);
        this.sparkle(p[0], p[1] - 22, 2);
      });
      g.on('levelup', () => {
        for (let i = 0; i < 26; i++) this.sparkle(this.low.width * Math.random(), this.low.height * (0.2 + Math.random() * 0.5), 1, 1.4);
      });
    }

    /* ───────── 版面 ───────── */

    resize() {
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      const cssW = this.el.clientWidth || window.innerWidth;
      const cssH = this.el.clientHeight || window.innerHeight;
      this.dpr = dpr;
      this.cssW = cssW;
      this.cssH = cssH;
      const devW = Math.round(cssW * dpr);
      const devH = Math.round(cssH * dpr);
      if (this.el.width !== devW || this.el.height !== devH) {
        this.el.width = devW;
        this.el.height = devH;
      }
      this.layout();
    }

    /** 依目前餐廳大小決定放大倍率與原點。 */
    layout() {
      const s = this.game.s;
      const layer = this.top ? AT.room(s.room.stage, s.room.floor, s.room.wall) : A.roomLayer(s.room.stage, s.room.floor, s.room.wall);
      // 窄螢幕（手機）的 HUD 與裝潢工具列比較高：上視圖多留一些空間，才不會被蓋住
      const narrow = this.top && this.cssW <= 560;
      const topUi = narrow ? 150 : this.top ? 96 : TOP_UI;
      const botUi = narrow ? 150 : BOTTOM_UI;
      const availW = Math.max(200, this.cssW - 12) * this.dpr;
      const availH = Math.max(160, this.cssH - topUi - botUi) * this.dpr;
      const raw = Math.min(availW / (layer.c.width + 8), availH / (layer.c.height + (this.top ? 4 : 12)));
      // 高密度螢幕可用 0.5 級距（不均勻幾乎看不出來）；一般螢幕維持整數倍以保持像素銳利
      let S = this.dpr >= 2 ? Math.floor(raw * 2) / 2 : Math.floor(raw);
      S = Math.max(1, Math.min(this.top ? 6 : 4, S));
      this.S = S;
      const lw = Math.ceil(this.el.width / S);
      const lh = Math.ceil(this.el.height / S);
      if (this.low.width !== lw || this.low.height !== lh) {
        this.low.width = lw;
        this.low.height = lh;
        this.lg = ctx(this.low);
        this.lg.imageSmoothingEnabled = false;
      }
      this.layer = layer;
      const topPx = (topUi * this.dpr) / S;
      const botPx = (botUi * this.dpr) / S;
      const x0 = Math.floor((lw - layer.c.width) / 2);
      const y0 = Math.floor(topPx + (lh - topPx - botPx - layer.c.height) / 2);
      this.x0 = x0;
      this.y0 = y0;
      this.ox = x0 + layer.ox; // tile(0,0) 頂點的邏輯座標
      this.oy = y0 + layer.oy;
      this.layerKey = this.roomKey();
    }

    roomKey() {
      const r = this.game.s.room;
      return (this.top ? 'T' : 'I') + r.stage + r.floor + r.wall;
    }

    /** 連續格座標 → 邏輯像素 */
    proj(gx, gy) {
      if (this.top) return [this.ox + gx * AT.T, this.oy + gy * AT.T];
      return [this.ox + (gx - gy) * 16, this.oy + (gx + gy) * 8];
    }
    /** 邏輯像素 → 連續格座標 */
    unproj(lx, ly) {
      if (this.top) return [(lx - this.ox) / AT.T, (ly - this.oy) / AT.T];
      const px = lx - this.ox;
      const py = ly - this.oy;
      return [(px / 16 + py / 8) / 2, (py / 8 - px / 16) / 2];
    }
    cssToLogical(cx, cy) {
      return [(cx * this.dpr) / this.S, (cy * this.dpr) / this.S];
    }
    /** 格座標 → CSS 像素（給 DOM 浮層定位） */
    tileToCss(gx, gy, z) {
      const p = this.proj(gx, gy);
      return { x: (p[0] * this.S) / this.dpr, y: ((p[1] - (this.top ? 0 : z || 0)) * this.S) / this.dpr };
    }
    tileAt(cssX, cssY) {
      const [lx, ly] = this.cssToLogical(cssX, cssY);
      const [gx, gy] = this.unproj(lx, ly);
      return { x: Math.floor(gx), y: Math.floor(gy) };
    }

    /* ───────── 特效 ───────── */

    burst(x, y, n) {
      for (let i = 0; i < n; i++) this.particles.push({ x, y, vx: (Math.random() - 0.5) * 50, vy: -30 - Math.random() * 40, g: 140, life: 0.7 + Math.random() * 0.3, t: 0, spr: 'coin' });
    }
    sparkle(x, y, n, spread) {
      for (let i = 0; i < n; i++) this.particles.push({ x, y, vx: (Math.random() - 0.5) * 30 * (spread || 1), vy: -10 - Math.random() * 25, g: 20, life: 0.6 + Math.random() * 0.4, t: 0, spr: 'spark' });
    }
    puff(x, y, n) {
      for (let i = 0; i < n; i++) this.particles.push({ x: x + (Math.random() - 0.5) * 6, y, vx: (Math.random() - 0.5) * 8, vy: -14 - Math.random() * 8, g: -4, life: 0.9, t: 0, spr: 'puff' });
    }
    stepFx(dt) {
      // 保險：極端情況（例如分頁長時間在背景）下不讓特效無限堆積
      if (this.particles.length > 300) this.particles.splice(0, this.particles.length - 300);
      if (this.floaters.length > 60) this.floaters.splice(0, this.floaters.length - 60);
      for (const f of this.floaters) f.t += dt;
      this.floaters = this.floaters.filter((f) => f.t < f.life);
      for (const p of this.particles) {
        p.t += dt;
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      this.particles = this.particles.filter((p) => p.t < p.life);
    }

    /* ───────── 主繪製 ───────── */

    render(dt) {
      this.time += dt;
      this.frameDt = dt;
      this.stepFx(dt);
      const s = this.game.s;
      if (this.layerKey !== this.roomKey()) this.layout();
      const g = this.lg;
      const W = this.low.width;
      const H = this.low.height;
      this.drawBackdrop(g, W, H);
      g.drawImage(this.layer.c, this.x0, this.y0);
      if (this.top) {
        this.drawTop(g);
      } else {
        this.drawWorld(g);
        this.drawNight(g, W, H);
        this.drawFx(g);
      }
      // 放大輸出
      const out = this.g;
      out.imageSmoothingEnabled = false;
      out.drawImage(this.low, 0, 0, W * this.S, H * this.S);
    }

    /** 夜間降低亮度：20:00 起漸暗，到 22:00 最暗，05:00 起漸亮，07:00 恢復 */
    drawNight(g, W, H) {
      const game = this.game;
      if (!game.dayMode) return;
      const h = game.hour;
      let a = 0;
      if (h >= 20 && h < 22) a = (h - 20) / 2;
      else if (h >= 22 || h < 5) a = 1;
      else if (h < 7) a = (7 - h) / 2;
      if (a <= 0) return;
      g.fillStyle = `rgba(16,24,70,${(0.38 * a).toFixed(3)})`;
      g.fillRect(0, 0, W, H);
    }

    drawBackdrop(g, W, H) {
      g.fillStyle = '#2b3a4a';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#304354';
      for (let y = 0; y < H; y += 16) for (let x = ((y / 16) & 1) * 16; x < W; x += 32) g.fillRect(x, y, 16, 16);
      // 輕微暗角
      g.fillStyle = 'rgba(10,8,25,0.18)';
      g.fillRect(0, 0, W, 6);
      g.fillRect(0, H - 6, W, 6);
    }

    /* ───────── 上視圖（裝潢模式） ───────── */

    drawTop(g) {
      const game = this.game;
      const grid = game.grid;
      const T = AT.T;
      const x0 = this.ox;
      const y0 = this.oy;
      // 門口前兩格要保持暢通
      g.fillStyle = 'rgba(255,226,90,0.28)';
      g.fillRect(x0, y0 + D.DOOR_Y * T, 2 * T, T);
      // 格線
      g.fillStyle = 'rgba(255,255,255,0.22)';
      for (let x = 0; x <= grid.w; x++) g.fillRect(x0 + x * T, y0, 1, grid.h * T);
      for (let y = 0; y <= grid.h; y++) g.fillRect(x0, y0 + y * T, grid.w * T, 1);
      // 家具
      for (const it of game.s.items) {
        const def = D.furniture[it.id];
        const face = def.cat === 'chair' ? (game.seatByChair.get(it.uid) || { face: it.rot }).face : it.rot;
        const e = AT.furniture(it.id, it.rot, face);
        g.drawImage(e.c, x0 + it.x * T, y0 + it.y * T);
      }
      // 人（遊戲暫停中，只是讓你知道他們站在哪）
      for (const m of game.crew) if (m.onDuty) this.topPerson(g, m.x, m.y, m.rec.look, m.boss ? '#e0b030' : '#f4f2ea');
      for (const c of game.customers) if (c.state !== 'arrive') this.topPerson(g, c.x, c.y, c.look, null);
      // 入口標示
      const dp = this.proj(0, D.DOOR_Y + 0.5);
      gfx.text(g, 'IN', Math.round(dp[0] + 2), Math.round(dp[1] - 3), '#fff4c0');
      this.drawEditOverlay(g);
    }

    topPerson(g, gx, gy, look, body) {
      const p = this.proj(gx, gy);
      const x = Math.round(p[0]);
      const y = Math.round(p[1]);
      gfx.ellipse(g, 'rgba(0,0,0,0.25)', x, y + 1, 4, 3);
      gfx.ellipse(g, gfx.OUTLINE, x, y, 4, 4);
      gfx.ellipse(g, body || D.PALETTE.top[look.top] || '#888', x, y, 3, 3);
      gfx.ellipse(g, D.PALETTE.hair[look.hair] || '#333', x, y - 1, 2, 2);
    }

    drawItemSprite(g, it, part, alpha) {
      const e = A.furniture(it.id, it.rot, part || 'all');
      const p = this.proj(it.x, it.y);
      if (alpha != null) g.globalAlpha = alpha;
      g.drawImage(e.c, p[0] - e.ax, p[1] - e.ay);
      if (alpha != null) g.globalAlpha = 1;
    }

    drawWorld(g) {
      const game = this.game;
      const s = game.s;
      const t = this.time;
      const list = [];
      const sitters = new Map();
      for (const c of game.customers) if (SEATED.includes(c.state)) sitters.set(c.seat, c);

      // 烹飪中的爐灶冒蒸氣
      this.stoveTimer -= this.frameDt;
      if (this.stoveTimer <= 0) {
        this.stoveTimer = 0.28;
        for (const m of game.crew) {
          const st = m.state === 'cooking' && game.stoveByUid.get(m.stove);
          if (st) {
            const p = this.proj(st.x + 0.5, st.y + 0.5);
            this.puff(p[0], p[1] - 18, 1);
          }
        }
      }

      for (const it of s.items) {
        const def = D.furniture[it.id];
        const fp = RC.world.footprint(def, it.rot);
        const key = it.x + fp.w / 2 + (it.y + fp.h / 2);
        if (def.cat === 'chair') {
          const seat = game.seatByChair.get(it.uid);
          const face = seat ? seat.face : it.rot;
          const view = { ...it, rot: face };
          const sitter = sitters.get(it.uid);
          if (sitter && face >= 2) {
            list.push({ k: key, f: () => this.drawItemSprite(g, view, 'base') });
            list.push({ k: key + 0.01, f: () => this.drawCustomer(g, sitter) });
            list.push({ k: key + 0.02, f: () => this.drawItemSprite(g, view, 'back') });
          } else {
            list.push({ k: key, f: () => this.drawItemSprite(g, view, 'all') });
            if (sitter) list.push({ k: key + 0.01, f: () => this.drawCustomer(g, sitter) });
          }
        } else {
          list.push({ k: key, f: () => this.drawItemSprite(g, it) });
        }
      }
      for (const c of game.customers) if (!SEATED.includes(c.state) && c.state !== 'arrive') list.push({ k: c.x + c.y, f: () => this.drawCustomer(g, c) });
      for (const m of game.crew) {
        if (m.onDuty) list.push({ k: m.x + m.y + 0.02, f: () => this.drawStaff(g, m) }); // 下班的人不在店裡
        else m._sx = null;
      }
      // 洗碗槽上堆著待洗的髒餐具
      if (s.sinkDirty > 0) {
        for (const sk of game.sinks) {
          const p = this.proj(sk.x + 0.5, sk.y + 0.5);
          list.push({ k: sk.x + sk.y + 1.05, f: () => g.drawImage(AP.fx('plates'), Math.round(p[0] - 4), Math.round(p[1] - 33)) });
        }
      }

      // 桌上的餐點與金幣
      for (const c of game.customers) {
        if (c.state !== 'eat') continue;
        const seat = game.seatByChair.get(c.seat);
        if (!seat) continue;
        list.push({ k: seat.tx + seat.ty + 1.1, f: () => this.drawPlate(g, seat, c) });
      }
      for (const d of game.dirty.values()) list.push({ k: d.x + d.y + 1.15, f: () => this.drawPlates(g, d) });

      list.sort((a, b) => a.k - b.k);
      for (const r of list) r.f();

      this.drawOverlays(g);
      this.drawQueue(g);
    }

    tableTopY(tx, ty) {
      const it = RC.world.itemAt(this.game.grid, tx, ty);
      const def = it && D.furniture[it.id];
      const z = !def ? 12 : def.id === 'table_round' ? 12 : def.id === 'table_red' ? 13 : def.id === 'table_marble' ? 14 : 12;
      return z;
    }

    drawPlate(g, seat, c) {
      const p = this.proj(seat.tx + 0.5, seat.ty + 0.5);
      const z = this.tableTopY(seat.tx, seat.ty);
      const spr = AP.dish(c.dish);
      const left = c.eatTotal ? c.t / c.eatTotal : 1;
      // 吃越多，餐點越淡（以透明度表示）
      g.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.min(1, left));
      g.drawImage(spr, Math.round(p[0] - (c.extra ? 9 : 6)), Math.round(p[1] - z - 9));
      if (c.extra) g.drawImage(AP.dish(c.extra), Math.round(p[0] + 1), Math.round(p[1] - z - 10)); // 套餐：兩道菜並排
      g.globalAlpha = 1;
    }

    drawPlates(g, d) {
      const p = this.proj(d.x + 0.5, d.y + 0.5);
      const z = this.tableTopY(d.x, d.y);
      g.drawImage(AP.fx('plates'), Math.round(p[0] - 4), Math.round(p[1] - z - 7));
    }

    drawCustomer(g, c) {
      const seated = SEATED.includes(c.state);
      const p = this.proj(c.x, c.y);
      let foot = p[1] + 3;
      const o = { dir: seated ? c.face : c.dir, vip: c.vip, moving: !seated && c.walking, walk: ((this.time * 8 + c.id) | 0) & 1 };
      if (seated) {
        o.pose = c.state === 'eat' ? 'eat' : 'sit';
        o.eat = ((this.time * 2.4) | 0) & 1;
        foot -= 4;
      }
      if (c.fade < 1) g.globalAlpha = c.fade;
      if (this.selectedActor && this.selectedActor.kind === 'customer' && this.selectedActor.id === c.id) this.ring(g, p[0], p[1] + 4);
      AP.drawPerson(g, p[0], foot, c.look, o);
      g.globalAlpha = 1;
      c._sx = p[0];
      c._sy = foot;
    }

    drawStaff(g, m) {
      const p = this.proj(m.x, m.y);
      const o = { dir: m.dir, staff: true, boss: m.boss, moving: m.walking && m.state !== 'rest', walk: ((this.time * 8 + m.id) | 0) & 1 };
      if (this.selectedActor && this.selectedActor.kind === 'staff' && this.selectedActor.id === m.id) this.ring(g, p[0], p[1] + 4);
      const jig = m.state === 'cooking' || m.state === 'cleaning' || m.state === 'paying' ? ((this.time * 6) | 0) & 1 : 0;
      AP.drawPerson(g, p[0], p[1] + 3 - jig, m.rec.look, o);
      m._sx = p[0];
      m._sy = p[1] + 3;
    }

    ring(g, x, y) {
      const a = 0.45 + 0.25 * Math.sin(this.time * 6);
      gfx.ellipse(g, 'rgba(255,230,90,' + a + ')', Math.round(x), Math.round(y), 10, 5);
    }

    /* ── 浮層：泡泡、進度條 ── */
    drawOverlays(g) {
      const game = this.game;
      const t = this.time;
      for (const c of game.customers) {
        if (c._sx == null) continue;
        const seated = SEATED.includes(c.state);
        const top = c._sy - (seated ? 25 : 30);
        const bob = Math.round(Math.sin(t * 4 + c.id) * 1);
        if (c.state === 'wait_order') {
          const b = AP.bubble(g, c._sx, top + bob, 14, 14, c.p < 0.3 ? '#ffd0c8' : '#fffaf0');
          g.drawImage(AP.fx('exclaim'), b.x + 5, b.y + 2);
          this.patience(g, c, top + bob + 2);
        } else if (c.state === 'ordering') {
          const b = AP.bubble(g, c._sx, top + bob, 14, 11, '#fffaf0');
          g.drawImage(AP.fx('dots'), b.x + 1, b.y + 1);
        } else if (c.state === 'wait_food') {
          const b = AP.bubble(g, c._sx, top + bob, c.extra ? 32 : 18, 18, c.p < 0.3 ? '#ffd0c8' : '#fffaf0');
          g.drawImage(AP.dish(c.dish), b.x + 2, b.y + 2);
          if (c.extra) g.drawImage(AP.dish(c.extra), b.x + 16, b.y + 2);
          this.patience(g, c, top + bob + 2);
        } else if (c.state === 'wait_pay') {
          // 吃完了：頭上出現金幣，等店掌櫃來結帳；掌櫃已經在路上時泡泡不再跳動
          const hop = c.payBy == null ? Math.round(Math.sin(t * 7 + c.id) * 1.5) : 0;
          const b = AP.bubble(g, c._sx, top + hop, 16, 16, c.rush ? '#ffe9a0' : '#fff3b0');
          g.drawImage(AP.fx('coin'), b.x + 3, b.y + 3);
          // 小費條：等越久越少
          this.bar(g, c._sx, top + hop - 20, Math.max(0, 1 - c.payWait / 30), '#f2c94c');
        } else if (c.state === 'leave' && c.t < 1.6) {
          if (c.angry) {
            const b = AP.bubble(g, c._sx, top + bob, 13, 12, '#ffd0c8');
            g.drawImage(AP.fx('anger'), b.x + 2, b.y + 2);
          } else if (c.paid) {
            const b = AP.bubble(g, c._sx, top + bob, 13, 12, '#fffaf0');
            g.drawImage(AP.fx('heart'), b.x + 2, b.y + 2);
          }
        }
        if (c.vip && c.state !== 'leave') g.drawImage(AP.fx('spark'), Math.round(c._sx + 8), Math.round(c._sy - 30 + Math.sin(t * 5) * 2));
      }
      for (const m of game.crew) {
        if (m._sx == null || !m.onDuty) continue;
        const top = m._sy - 33;
        if (m.state === 'cooking') this.bar(g, m._sx, top, m.cookTotal ? 1 - m.t / m.cookTotal : 0, '#ff9a3a');
        else if (m.state === 'cleaning') this.bar(g, m._sx, top, m.cleanTotal ? 1 - m.t / m.cleanTotal : 0, '#6fc3e0');
        else if (m.state === 'paying') this.bar(g, m._sx, top, m.payTotal ? 1 - m.t / m.payTotal : 0, '#ffd84a');
        else if (m.state === 'rest') {
          const b = AP.bubble(g, m._sx, top, 15, 12, '#fffaf0');
          g.drawImage(AP.fx('zzz'), b.x + 2, b.y + 2 + (((t * 2) | 0) & 1));
        } else if (m.state === 'wait_stove') {
          const b = AP.bubble(g, m._sx, top, 15, 11, '#fff0c0');
          g.drawImage(AP.fx('dots'), b.x + 2, b.y + 1);
        } else if (m.state === 'washing') this.bar(g, m._sx, top, m.washTotal ? 1 - m.t / m.washTotal : 0, '#6fc3e0');
        else if (m.state === 'wait_plate') {
          const b = AP.bubble(g, m._sx, top, 15, 11, '#ffd0c8');
          g.drawImage(AP.fx('dots'), b.x + 2, b.y + 1);
        } else if (m.carryPlates > 0) {
          g.drawImage(AP.fx('plates'), Math.round(m._sx - 4), Math.round(top - 4 + Math.sin(t * 8)));
        } else if (m.carry) {
          g.drawImage(AP.dish(m.carry), Math.round(m._sx - 6), Math.round(top - 8 + Math.sin(t * 8)));
        }
        if (m.rec.manager) {
          g.fillStyle = '#4a82c8';
          g.fillRect(Math.round(m._sx - 7), Math.round(top + 7), 3, 3);
          g.fillStyle = '#ffffff';
          g.fillRect(Math.round(m._sx - 6), Math.round(top + 8), 1, 1);
        }
        if (!m.boss && m.rec.energy < 30 && m.state !== 'rest') g.drawImage(AP.icon('bolt'), Math.round(m._sx + 5), Math.round(top + 6));
      }
    }

    /** 門外候位：每組一個小標籤，顯示人數（小頭像）與剩餘耐心；每排 3 組，往門的左側排開。 */
    drawQueue(g) {
      const q = this.game.queue;
      if (!q.length) return;
      const base = this.proj(0, D.DOOR_Y + 0.5);
      const h = 14;
      const right = Math.round(base[0] + 6);
      const y0 = Math.round(base[1] - A.WALL_H - 12);
      let x = right;
      q.slice(0, 6).forEach((party, i) => {
        if (i % 3 === 0) x = right;
        const row = Math.floor(i / 3);
        const w = 6 + party.size * 8;
        const yy = y0 - row * (h + 2);
        const xx = x - w;
        g.fillStyle = gfx.OUTLINE;
        g.fillRect(xx, yy, w, h);
        g.fillStyle = party.p < 0.3 ? '#ffd0c8' : '#fffaf0';
        g.fillRect(xx + 1, yy + 1, w - 2, h - 2);
        for (let k = 0; k < party.size; k++) AP.drawHead(g, xx + 3 + k * 8, yy + 2, party.looks[k]);
        const col = party.p > 0.55 ? '#5fd35f' : party.p > 0.25 ? '#f2c94c' : '#e8493a';
        g.fillStyle = '#5a4a40';
        g.fillRect(xx + 2, yy + h - 4, w - 4, 2);
        g.fillStyle = col;
        g.fillRect(xx + 2, yy + h - 4, Math.max(0, Math.round((w - 4) * party.p)), 2);
        x = xx - 2;
      });
      // 指向門口的小箭頭
      const cx = Math.round(base[0] - 2);
      g.fillStyle = gfx.OUTLINE;
      g.fillRect(cx - 2, y0 + h, 5, 1);
      g.fillRect(cx - 1, y0 + h + 1, 3, 1);
      g.fillRect(cx, y0 + h + 2, 1, 1);
    }

    bar(g, cx, y, frac, col) {
      const w = 14;
      const x = Math.round(cx - w / 2);
      g.fillStyle = gfx.OUTLINE;
      g.fillRect(x - 1, y - 1, w + 2, 5);
      g.fillStyle = '#5a4a40';
      g.fillRect(x, y, w, 3);
      g.fillStyle = col;
      g.fillRect(x, y, Math.max(0, Math.round(w * Math.min(1, frac))), 3);
    }
    patience(g, c, y) {
      const col = c.p > 0.55 ? '#5fd35f' : c.p > 0.25 ? '#f2c94c' : '#e8493a';
      this.bar(g, c._sx, y - 20, Math.max(0, c.p), col);
    }

    drawFx(g) {
      for (const p of this.particles) {
        const k = 1 - p.t / p.life;
        if (p.spr === 'puff') {
          g.globalAlpha = Math.max(0, k * 0.8);
          g.fillStyle = '#fff';
          const r = 1 + Math.floor((1 - k) * 2);
          g.fillRect(Math.round(p.x), Math.round(p.y), r + 1, r + 1);
          g.globalAlpha = 1;
        } else {
          g.globalAlpha = Math.min(1, k * 2);
          g.drawImage(AP.fx(p.spr), Math.round(p.x - 4), Math.round(p.y - 4));
          g.globalAlpha = 1;
        }
      }
      for (const f of this.floaters) {
        const k = f.t / f.life;
        const y = Math.round(f.y - k * 18);
        g.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
        const w = gfx.textWidth(f.text);
        const x = Math.round(f.x - (w + (f.coin ? 9 : 0)) / 2);
        if (f.coin) g.drawImage(AP.fx('coin'), x, y - 2);
        gfx.text(g, f.text, x + (f.coin ? 9 : 0), y, '#ffe27a');
        g.globalAlpha = 1;
      }
      this.drawEditOverlay(g);
    }

    /* ── 編輯模式（上視圖）：選取與放置預覽 ── */
    drawEditOverlay(g) {
      if (!this.edit) return;
      const game = this.game;
      const T = AT.T;
      if (this.selectedItem != null) {
        const it = game.s.items.find((i) => i.uid === this.selectedItem);
        if (it) {
          const fp = RC.world.footprint(D.furniture[it.id], it.rot);
          const a = 0.6 + 0.4 * Math.sin(this.time * 7);
          const p = this.proj(it.x, it.y);
          g.fillStyle = 'rgba(255,220,60,' + (0.22 + 0.15 * a) + ')';
          g.fillRect(p[0], p[1], fp.w * T, fp.h * T);
          this.frame(g, p[0], p[1], fp.w * T, fp.h * T, '#ffe14a');
        }
      }
      const gh = this.ghost;
      if (gh) {
        const def = D.furniture[gh.id];
        const rot = gh.rot;
        const fp = RC.world.footprint(def, rot);
        const p = this.proj(gh.tx, gh.ty);
        let r2 = rot;
        if (def.cat === 'chair') {
          // 預覽時讓椅子自動面向相鄰的桌子
          const grid = game.grid;
          for (let k = 0; k < 4; k++) {
            const d = (rot + k) & 3;
            const o = RC.world.itemAt(grid, gh.tx + D.DX[d], gh.ty + D.DY[d]);
            if (o && D.furniture[o.id].cat === 'table') {
              r2 = d;
              break;
            }
          }
        }
        const e = AT.furniture(gh.id, rot, r2);
        g.globalAlpha = 0.85;
        g.drawImage(e.c, p[0], p[1]);
        g.globalAlpha = 1;
        g.fillStyle = gh.ok ? 'rgba(80,230,120,0.4)' : 'rgba(240,70,60,0.5)';
        g.fillRect(p[0], p[1], fp.w * T, fp.h * T);
        this.frame(g, p[0], p[1], fp.w * T, fp.h * T, gh.ok ? '#5fe88a' : '#ff5a4a');
      }
    }

    /** 1px 外框 */
    frame(g, x, y, w, h, color) {
      g.fillStyle = color;
      g.fillRect(x, y, w, 1);
      g.fillRect(x, y + h - 1, w, 1);
      g.fillRect(x, y, 1, h);
      g.fillRect(x + w - 1, y, 1, h);
    }

    /* ───────── 點擊判定 ───────── */

    /** 回傳最上層被點到的東西：{type:'staff'|'customer'|'item', ...} 或 null */
    pick(cssX, cssY) {
      const [lx, ly] = this.cssToLogical(cssX, cssY);
      const game = this.game;
      if (this.edit) {
        const it = this.pickItem(lx, ly);
        if (it) return { type: 'item', item: it };
        return null;
      }
      const hit = (e, w, hgt, depth) => e._sx != null && Math.abs(lx - e._sx) <= w && ly >= e._sy - hgt && ly <= e._sy + 3 ? { depth } : null;
      let top = null;
      for (const m of game.crew) {
        if (!m.onDuty) continue;
        const h = hit(m, 7, 30, m.x + m.y);
        if (h && (!top || h.depth > top.depth)) top = { type: 'staff', id: m.id, depth: h.depth };
      }
      for (const c of game.customers) {
        const h = hit(c, 7, c.state === 'wait_pay' ? 48 : 28, c.x + c.y); // 等結帳時，頭上的金幣泡泡也可以點
        if (h && (!top || h.depth > top.depth)) top = { type: 'customer', id: c.id, depth: h.depth };
      }
      return top;
    }

    /** 上視圖：點到哪一格就是哪件家具。 */
    pickItem(lx, ly) {
      const [gx, gy] = this.unproj(lx, ly);
      return RC.world.itemAt(this.game.grid, Math.floor(gx), Math.floor(gy)) || null;
    }
  }

  RC.Renderer = Renderer;
})(typeof globalThis !== 'undefined' ? globalThis : window);
