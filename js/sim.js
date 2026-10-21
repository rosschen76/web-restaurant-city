/* 遊戲模擬核心：客人、員工、點餐→烹飪→上菜→收款、經濟、升級、任務。
 * 不碰 DOM／Canvas，Node 可直接跑測試。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});
  const D = RC.data;
  const W = RC.world;
  const { clamp, makeRng, Emitter } = RC.util;
  const { DX, DY } = D;

  const CUSTOMER_SPEED = 1.9; // 格/秒
  const STAFF_SPEED = 2.3;
  const ORDER_PATIENCE = 38; // 等員工來點餐的耐心（秒）
  const FOOD_PATIENCE = 60; // 等餐耐心（秒，另加烹飪時間）
  const TAKE_ORDER_TIME = 0.8;
  const SERVE_TIME = 0.5;
  const REST_BELOW = 15;
  const REST_UNTIL = 60;

  class Game {
    constructor(state, opts) {
      opts = opts || {};
      this.s = state;
      this.rng = makeRng(opts.seed != null ? opts.seed : (Date.now() & 0xffffffff) >>> 0);
      this.ev = new Emitter();
      this.speed = state.settings.speed || 1;
      this.paused = false;
      this.customers = [];
      this.crew = [];
      this.nextCid = 1;
      this.stoveBusy = new Map(); // stove uid -> staff id
      this.seatTaken = new Map(); // chair uid -> customer id
      this.spawnTimer = 3;
      this.autosaveTimer = 0;
      this.rebuild();
      for (const rec of state.staff) this.addCrew(rec);
    }

    on(name, fn) {
      return this.ev.on(name, fn);
    }
    emit(name, a, b) {
      this.ev.emit(name, a, b);
    }
    toast(msg, kind) {
      this.emit('toast', { msg, kind: kind || 'info' });
    }
    changed() {
      this.emit('changed');
    }

    /* ───────── 版面 / 衍生數值 ───────── */

    get room() {
      return D.expansions[this.s.room.stage];
    }

    rebuild() {
      const s = this.s;
      const room = this.room;
      this.grid = W.buildGrid(s.items, room.w, room.h, D.DOOR_Y);
      this.seats = W.findSeats(this.grid);
      this.seatByChair = new Map(this.seats.map((x) => [x.uid, x]));
      this.stoves = W.findStoves(this.grid);
      this.stoveByUid = new Map(this.stoves.map((x) => [x.uid, x]));
      this.recalc();
      this.afterLayoutChange();
    }

    /** 魅力值（遞減計算）→ 星級；另算出收銀機、冰箱效果。 */
    recalc() {
      const s = this.s;
      const counts = {};
      for (const it of s.items) counts[it.id] = (counts[it.id] || 0) + 1;
      let appeal = 0;
      for (const [id, n] of Object.entries(counts)) {
        const a = D.furniture[id].appeal;
        for (let k = 1; k <= n; k++) appeal += a * (k <= 3 ? 1 : k <= 6 ? 0.5 : 0.2);
      }
      appeal += D.floors[s.room.floor].appeal + D.walls[s.room.wall].appeal;
      this.appeal = appeal;
      this.stars = D.starsForAppeal(appeal);
      this.hasRegister = !!counts.register;
      this.fridgeBonus = Math.min(3, counts.fridge || 0) * 0.06;
      this.counts = counts;
    }

    /** 版面變動後：把被家具壓到的人移開、重算路徑、取消失效的工作。 */
    afterLayoutChange() {
      const g = this.grid;
      // 店內掉落的金幣若桌子不見了就直接入帳
      for (const key of Object.keys(this.s.drops)) {
        const [x, y] = key.split(',').map(Number);
        const o = W.itemAt(g, x, y);
        if (!o || D.furniture[o.id].cat !== 'table') {
          const amt = this.s.drops[key];
          delete this.s.drops[key];
          this.addCoins(amt, x + 0.5, y + 0.5, true);
        }
      }
      for (const c of this.customers.slice()) {
        if (c.state === 'leave') continue;
        const seat = this.seatByChair.get(c.seat);
        if (!seat) {
          this.sendHome(c, false);
          continue;
        }
        if (c.state === 'enter') {
          const p = W.findPath(g, Math.floor(c.x), Math.floor(c.y), seat.x, seat.y);
          if (p) c.path = p;
          else this.sendHome(c, false);
        } else {
          c.x = seat.x + 0.5;
          c.y = seat.y + 0.5;
          c.face = seat.face;
        }
      }
      for (const c of this.customers) {
        if (c.state === 'leave') {
          this.relocateIfBlocked(c);
          c.path = W.findPath(g, Math.floor(c.x), Math.floor(c.y), g.door.x, g.door.y) || [];
        }
      }
      for (const m of this.crew) {
        this.abortJob(m);
        this.relocateIfBlocked(m);
      }
    }

    relocateIfBlocked(e) {
      const tx = Math.floor(e.x);
      const ty = Math.floor(e.y);
      if (!W.walkable(this.grid, tx, ty)) {
        const t = W.nearestWalkable(this.grid, tx, ty);
        e.x = t.x + 0.5;
        e.y = t.y + 0.5;
        e.path = [];
      }
    }

    /* ───────── 金幣 / 經驗 ───────── */

    addCoins(n, x, y, silent) {
      this.s.coins += n;
      this.s.stats.earned += Math.max(0, n);
      if (!silent) this.emit('coins', { n, x, y });
      else this.emit('coins', { n, x, y, silent: true });
    }

    addXp(n) {
      const s = this.s;
      if (s.level >= D.MAX_LEVEL) return;
      s.xp += n;
      while (s.level < D.MAX_LEVEL && s.xp >= D.xpForLevel(s.level)) {
        s.xp -= D.xpForLevel(s.level);
        s.level++;
        const reward = D.levelReward(s.level);
        s.coins += reward;
        this.emit('levelup', { level: s.level, reward, unlocks: D.unlocksAt(s.level) });
      }
      if (s.level >= D.MAX_LEVEL) s.xp = 0;
    }

    /* ───────── 數值公式 ───────── */

    dishInfo(id) {
      const d = D.dishes[id];
      const rec = this.s.dishes[id];
      const cooked = rec ? rec.cooked : 0;
      const m = D.masteryLevel(cooked);
      const price = Math.round(d.price * (1 + 0.08 * (m - 1)) * (1 + 0.04 * (this.stars - 1)));
      return { def: d, mastery: m, cooked, price, learned: !!rec };
    }

    cookTime(dishId, stoveSpeed, skill) {
      const m = D.masteryLevel(this.s.dishes[dishId].cooked);
      const base = D.dishes[dishId].cook * (1 - 0.05 * (m - 1)) * (1 - this.fridgeBonus);
      return Math.max(1.2, base / (stoveSpeed * skill));
    }

    spawnInterval() {
      const base = 9 / (1 + this.appeal / 50) / (1 + 0.04 * (this.s.level - 1));
      return clamp(base, 1.5, 9) * this.rng.range(0.7, 1.3);
    }

    /* ───────── 員工 ───────── */

    addCrew(rec) {
      const spot = W.nearestWalkable(this.grid, 2, 2);
      const m = {
        rec,
        id: rec.id,
        x: spot.x + 0.5,
        y: spot.y + 0.5,
        dir: 0,
        path: [],
        state: 'idle',
        t: 0,
        idleT: this.rng.range(0.5, 3),
        job: null,
        stove: null,
        carry: null,
        cookTotal: 1,
      };
      this.crew.push(m);
      return m;
    }

    crewById(id) {
      return this.crew.find((m) => m.id === id);
    }
    customerById(id) {
      return this.customers.find((c) => c.id === id);
    }

    abortJob(m) {
      if (m.job) {
        const c = this.customerById(m.job.cid);
        if (c && c.claimedBy === m.id) {
          c.claimedBy = null;
          if (c.state === 'ordering' || c.state === 'wait_food') c.state = 'wait_order';
        }
      }
      if (m.stove != null && this.stoveBusy.get(m.stove) === m.id) this.stoveBusy.delete(m.stove);
      m.job = null;
      m.stove = null;
      m.carry = null;
      m.path = [];
      if (m.state !== 'rest') m.state = 'idle';
      m.idleT = 0.3;
    }

    /* ───────── 客人 ───────── */

    freeSeats() {
      return this.seats.filter((x) => !this.seatTaken.has(x.uid));
    }

    trySpawn() {
      if (!this.stoves.length) return false;
      const free = this.freeSeats();
      if (!free.length) return false;
      const g = this.grid;
      const seat = this.rng.pick(free);
      const path = W.findPath(g, g.door.x, g.door.y, seat.x, seat.y);
      if (!path) return false;
      const vipChance = clamp(0.015 + this.stars * 0.008, 0, 0.1);
      const vip = this.s.level >= 3 && this.rng.chance(vipChance);
      const c = {
        id: this.nextCid++,
        look: RC.state.makeLook(this.rng),
        vip,
        vipTitle: vip ? this.rng.pick(D.VIP_TITLES) : null,
        x: g.door.x + 0.5,
        y: g.door.y + 0.5,
        dir: 0,
        face: 0,
        path,
        state: 'enter',
        t: 0,
        seat: seat.uid,
        dish: null,
        p: 1,
        claimedBy: null,
        mood: 'ok',
        fade: 0,
        eatTotal: 1,
      };
      this.seatTaken.set(seat.uid, c.id);
      this.customers.push(c);
      return true;
    }

    pickDish() {
      const learned = Object.keys(this.s.dishes);
      return this.rng.pick(learned);
    }

    /** 客人帶著怒氣或因版面變動離開；angry 為 true 會記一次差評。 */
    sendHome(c, angry) {
      if (c.state === 'leave') return;
      if (c.claimedBy != null) {
        const m = this.crewById(c.claimedBy);
        if (m) this.abortJob(m);
      }
      this.seatTaken.delete(c.seat);
      c.claimedBy = null;
      c.state = 'leave';
      c.angry = !!angry;
      if (angry) {
        this.s.stats.angry++;
        this.emit('angry', { x: c.x, y: c.y });
      }
      const g = this.grid;
      this.relocateIfBlocked(c);
      c.path = W.findPath(g, Math.floor(c.x), Math.floor(c.y), g.door.x, g.door.y);
      if (!c.path) c.path = [];
      c.dead = c.path.length === 0 && Math.floor(c.x) === g.door.x && Math.floor(c.y) === g.door.y;
    }

    /** 沿路徑前進；回傳 true 表示已走完。 */
    follow(e, speed, dt) {
      let move = speed * dt;
      while (move > 0 && e.path.length) {
        const n = e.path[0];
        const tx = n.x + 0.5;
        const ty = n.y + 0.5;
        const dx = tx - e.x;
        const dy = ty - e.y;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist > 0.0001) e.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
        if (dist <= move) {
          e.x = tx;
          e.y = ty;
          e.path.shift();
          move -= dist;
        } else {
          e.x += (dx / dist) * move;
          e.y += (dy / dist) * move;
          move = 0;
        }
      }
      e.walking = e.path.length > 0;
      return !e.walking;
    }

    stepCustomer(c, dt) {
      const seat = this.seatByChair.get(c.seat);
      c.fade = Math.min(1, c.fade + dt * 3);
      switch (c.state) {
        case 'enter':
          if (this.follow(c, CUSTOMER_SPEED, dt) && seat) {
            c.x = seat.x + 0.5;
            c.y = seat.y + 0.5;
            c.face = seat.face;
            c.state = 'browse';
            c.t = this.rng.range(1.2, 2.6);
          }
          break;
        case 'browse':
          c.t -= dt;
          if (c.t <= 0) {
            c.dish = this.pickDish();
            c.state = 'wait_order';
            c.p = 1;
          }
          break;
        case 'wait_order':
          c.p -= dt / (ORDER_PATIENCE * (c.vip ? 0.8 : 1));
          break;
        case 'ordering':
          break;
        case 'wait_food':
          c.p -= dt / (FOOD_PATIENCE + D.dishes[c.dish].cook * 2);
          break;
        case 'eat':
          c.t -= dt;
          if (c.t <= 0) this.finishMeal(c);
          break;
        case 'leave':
          c.walking = false;
          if (this.follow(c, CUSTOMER_SPEED * 1.15, dt) || c.dead) c.gone = true;
          break;
        default:
      }
      if (c.state === 'wait_order' || c.state === 'wait_food') {
        c.mood = c.p > 0.55 ? 'happy' : c.p > 0.25 ? 'ok' : 'mad';
        if (c.p <= 0) this.sendHome(c, true);
      }
    }

    finishMeal(c) {
      const s = this.s;
      const info = this.dishInfo(c.dish);
      const mult = c.vip ? 3 : 1;
      const speedBonus = clamp((c.servedP - 0.5) * 2, 0, 1); // 上菜越快小費越多
      const tip = Math.round(info.price * 0.5 * speedBonus * mult);
      const total = info.price * mult + tip;
      s.stats.served++;
      s.stats.tips += tip;
      this.addXp(info.def.xp * mult);
      const seat = this.seatByChair.get(c.seat);
      this.seatTaken.delete(c.seat);
      c.mood = 'happy';
      c.paid = total;
      if (seat) {
        if (this.hasRegister) {
          this.addCoins(total, seat.tx + 0.5, seat.ty + 0.5);
          this.emit('collect', { auto: true });
        } else {
          const key = seat.tx + ',' + seat.ty;
          s.drops[key] = (s.drops[key] || 0) + total;
          this.emit('drop', { x: seat.tx + 0.5, y: seat.ty + 0.5, amount: total });
        }
      }
      this.emit('served', { vip: c.vip, tip });
      // 離座
      c.state = 'leave';
      const g = this.grid;
      c.path = W.findPath(g, Math.floor(c.x), Math.floor(c.y), g.door.x, g.door.y) || [];
      this.changed();
    }

    /* ───────── 員工行為 ───────── */

    dispatch() {
      const waiting = this.customers.filter((c) => c.state === 'wait_order' && c.claimedBy == null);
      if (!waiting.length) return;
      const idle = this.crew.filter((m) => m.state === 'idle' && m.rec.energy > REST_BELOW);
      if (!idle.length) return;
      waiting.sort((a, b) => a.p - b.p);
      for (const c of waiting) {
        const seat = this.seatByChair.get(c.seat);
        if (!seat) continue;
        let best = null;
        for (const m of idle) {
          if (m.job) continue;
          const r = W.nearestReachable(this.grid, Math.floor(m.x), Math.floor(m.y), seat.access);
          if (r && (!best || r.path.length < best.path.length)) best = { m, ...r };
        }
        if (!best) continue;
        const m = best.m;
        m.job = { cid: c.id };
        m.state = 'to_customer';
        m.path = best.path;
        c.claimedBy = m.id;
        idle.splice(idle.indexOf(m), 1);
        if (!idle.length) break;
      }
    }

    claimStove(m) {
      let best = null;
      for (const st of this.stoves) {
        if (this.stoveBusy.has(st.uid)) continue;
        const r = W.nearestReachable(this.grid, Math.floor(m.x), Math.floor(m.y), st.access);
        if (!r) continue;
        // 偏好近的、也偏好快的爐灶
        const score = r.path.length - st.speed * 2;
        if (!best || score < best.score) best = { st, r, score };
      }
      if (!best) return false;
      this.stoveBusy.set(best.st.uid, m.id);
      m.stove = best.st.uid;
      m.path = best.r.path;
      m.state = 'to_stove';
      return true;
    }

    stepStaff(m, dt) {
      const rec = m.rec;
      const spd = STAFF_SPEED * rec.speed;
      const c = m.job ? this.customerById(m.job.cid) : null;
      if (m.job && (!c || c.state === 'leave' || c.claimedBy !== m.id)) {
        this.abortJob(m);
      }
      switch (m.state) {
        case 'idle': {
          m.walking = false;
          rec.energy = Math.min(100, rec.energy + dt * 1.0);
          if (rec.energy <= REST_BELOW) {
            m.state = 'rest';
            break;
          }
          m.idleT -= dt;
          if (m.path.length) {
            this.follow(m, spd * 0.6, dt);
          } else if (m.idleT <= 0) {
            m.idleT = this.rng.range(2.5, 6);
            const tx = clamp(Math.floor(m.x) + this.rng.int(-2, 2), 0, this.grid.w - 1);
            const ty = clamp(Math.floor(m.y) + this.rng.int(-2, 2), 0, this.grid.h - 1);
            if (W.walkable(this.grid, tx, ty)) m.path = W.findPath(this.grid, Math.floor(m.x), Math.floor(m.y), tx, ty) || [];
          }
          break;
        }
        case 'rest':
          m.walking = false;
          m.path = [];
          rec.energy = Math.min(100, rec.energy + dt * 5);
          if (rec.energy >= REST_UNTIL) m.state = 'idle';
          break;
        case 'to_customer':
          if (this.follow(m, spd, dt)) {
            m.state = 'taking';
            m.t = TAKE_ORDER_TIME / rec.speed;
            c.state = 'ordering';
            this.faceTo(m, c);
          }
          break;
        case 'taking':
          m.t -= dt;
          if (m.t <= 0) {
            c.state = 'wait_food';
            if (!this.claimStove(m)) m.state = 'wait_stove';
            m.t = 0.3;
          }
          break;
        case 'wait_stove':
          m.t -= dt;
          if (m.t <= 0) {
            m.t = 0.3;
            this.claimStove(m);
          }
          break;
        case 'to_stove':
          if (this.follow(m, spd, dt)) {
            const st = this.stoveByUid.get(m.stove);
            m.state = 'cooking';
            m.cookTotal = this.cookTime(c.dish, st ? st.speed : 1, rec.skill);
            m.t = m.cookTotal;
            if (st) m.dir = this.dirToward(m, st.x + 0.5, st.y + 0.5);
          }
          break;
        case 'cooking':
          m.t -= dt;
          if (m.t <= 0) {
            this.s.dishes[c.dish].cooked++;
            if (this.stoveBusy.get(m.stove) === m.id) this.stoveBusy.delete(m.stove);
            m.stove = null;
            m.carry = c.dish;
            const seat = this.seatByChair.get(c.seat);
            const r = seat && W.nearestReachable(this.grid, Math.floor(m.x), Math.floor(m.y), seat.access);
            if (!r) {
              this.abortJob(m);
            } else {
              m.path = r.path;
              m.state = 'to_serve';
              this.emit('cooked', { x: m.x, y: m.y });
            }
          }
          break;
        case 'to_serve':
          if (this.follow(m, spd, dt)) {
            m.state = 'serving';
            m.t = SERVE_TIME / rec.speed;
            this.faceTo(m, c);
          }
          break;
        case 'serving':
          m.t -= dt;
          if (m.t <= 0) {
            c.state = 'eat';
            c.servedP = c.p;
            c.t = D.dishes[c.dish].eat * this.rng.range(0.85, 1.15);
            c.eatTotal = c.t;
            c.claimedBy = null;
            this.gainStaffXp(rec);
            rec.energy = Math.max(0, rec.energy - (4 + D.dishes[c.dish].cook * 0.7));
            m.job = null;
            m.carry = null;
            m.state = 'idle';
            m.idleT = 0.4;
            this.emit('delivered', { x: c.x, y: c.y });
          }
          break;
        default:
      }
    }

    gainStaffXp(rec) {
      rec.xp++;
      const steps = D.STAFF_XP_STEPS;
      if (rec.level < steps.length && rec.xp >= steps[rec.level]) {
        rec.level++;
        rec.skill = Math.round((rec.skill + 0.03) * 100) / 100;
        rec.speed = Math.round((rec.speed + 0.02) * 100) / 100;
        this.toast(rec.name + ' 升到 Lv.' + rec.level + '！', 'good');
        this.emit('sfx', 'levelup');
      }
    }

    dirToward(e, tx, ty) {
      const dx = tx - e.x;
      const dy = ty - e.y;
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
    }
    faceTo(m, c) {
      m.dir = this.dirToward(m, c.x, c.y);
    }

    /* ───────── 主迴圈 ───────── */

    update(dtReal) {
      if (this.paused) return;
      let left = Math.min(dtReal, 0.5) * this.speed;
      while (left > 1e-6) {
        const h = Math.min(left, 0.1);
        this.step(h);
        left -= h;
      }
    }

    step(dt) {
      this.s.stats.playTime += dt;
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.trySpawn();
        this.spawnTimer = this.spawnInterval();
      }
      for (const c of this.customers) this.stepCustomer(c, dt);
      this.customers = this.customers.filter((c) => !c.gone);
      this.dispatch();
      for (const m of this.crew) this.stepStaff(m, dt);
    }

    /* ───────── 玩家動作（回傳 {ok, msg}） ───────── */

    fail(msg) {
      return { ok: false, msg };
    }
    done(msg) {
      this.changed();
      return { ok: true, msg };
    }

    buyFurniture(id) {
      const def = D.furniture[id];
      const s = this.s;
      if (!def) return this.fail('找不到這個商品');
      if (s.level < def.level) return this.fail('需要等級 ' + def.level);
      if (s.coins < def.price) return this.fail('金幣不足');
      s.coins -= def.price;
      s.inventory[id] = (s.inventory[id] || 0) + 1;
      return this.done();
    }

    placeFromInventory(id, x, y, rot) {
      const s = this.s;
      const def = D.furniture[id];
      if (!def || !(s.inventory[id] > 0)) return this.fail('倉庫裡沒有這個物品');
      const r = W.canPlace(this.grid, def, x, y, rot, null);
      if (!r.ok) return this.fail(r.reason);
      s.inventory[id]--;
      if (!s.inventory[id]) delete s.inventory[id];
      s.items.push({ uid: s.nextUid++, id, x, y, rot: rot & 3 });
      this.rebuild();
      return this.done();
    }

    moveItem(uid, x, y, rot) {
      const it = this.s.items.find((i) => i.uid === uid);
      if (!it) return this.fail('找不到物品');
      const r = W.canPlace(this.grid, D.furniture[it.id], x, y, rot, uid);
      if (!r.ok) return this.fail(r.reason);
      it.x = x;
      it.y = y;
      it.rot = rot & 3;
      this.rebuild();
      return this.done();
    }

    rotateItem(uid) {
      const it = this.s.items.find((i) => i.uid === uid);
      if (!it) return this.fail('找不到物品');
      const def = D.furniture[it.id];
      let rot = it.rot;
      for (let k = 1; k <= 4; k++) {
        const nr = (it.rot + k) & 3;
        if (W.canPlace(this.grid, def, it.x, it.y, nr, uid).ok) {
          rot = nr;
          break;
        }
      }
      it.rot = rot;
      this.rebuild();
      return this.done();
    }

    storeItem(uid) {
      const s = this.s;
      const i = s.items.findIndex((x) => x.uid === uid);
      if (i < 0) return this.fail('找不到物品');
      const it = s.items[i];
      s.items.splice(i, 1);
      s.inventory[it.id] = (s.inventory[it.id] || 0) + 1;
      this.rebuild();
      return this.done();
    }

    sellItem(uid) {
      const s = this.s;
      const i = s.items.findIndex((x) => x.uid === uid);
      if (i < 0) return this.fail('找不到物品');
      const it = s.items[i];
      const gain = Math.floor(D.furniture[it.id].price / 2);
      s.items.splice(i, 1);
      s.coins += gain;
      this.rebuild();
      return this.done('賣出獲得 ' + gain);
    }

    sellFromInventory(id) {
      const s = this.s;
      if (!(s.inventory[id] > 0)) return this.fail('倉庫裡沒有這個物品');
      s.inventory[id]--;
      if (!s.inventory[id]) delete s.inventory[id];
      s.coins += Math.floor(D.furniture[id].price / 2);
      return this.done();
    }

    learnDish(id) {
      const s = this.s;
      const d = D.dishes[id];
      if (!d) return this.fail('找不到菜色');
      if (s.dishes[id]) return this.fail('已經學會了');
      if (s.level < d.level) return this.fail('需要等級 ' + d.level);
      if (s.coins < d.learn) return this.fail('金幣不足');
      s.coins -= d.learn;
      s.dishes[id] = { cooked: 0 };
      return this.done();
    }

    buyTheme(kind, id) {
      const s = this.s;
      const list = kind === 'floor' ? D.floors : D.walls;
      const own = kind === 'floor' ? s.owned.floors : s.owned.walls;
      const t = list[id];
      if (!t) return this.fail('找不到主題');
      if (!own.includes(id)) {
        if (s.level < t.level) return this.fail('需要等級 ' + t.level);
        if (s.coins < t.price) return this.fail('金幣不足');
        s.coins -= t.price;
        own.push(id);
      }
      s.room[kind] = id;
      this.recalc();
      return this.done();
    }

    expand() {
      const s = this.s;
      const next = D.expansions[s.room.stage + 1];
      if (!next) return this.fail('已經是最大的餐廳了');
      if (s.level < next.level) return this.fail('需要等級 ' + next.level);
      if (s.coins < next.cost) return this.fail('金幣不足');
      s.coins -= next.cost;
      s.room.stage++;
      this.rebuild();
      return this.done();
    }

    hire(idx) {
      const s = this.s;
      const cand = s.candidates[idx];
      if (!cand) return this.fail('找不到應徵者');
      if (s.staff.length >= D.maxStaffForLevel(s.level)) return this.fail('員工人數已達上限，升級可增加名額');
      const cost = RC.state.hireCost(cand, s.staff.length);
      if (s.coins < cost) return this.fail('金幣不足');
      s.coins -= cost;
      const rec = RC.state.newStaff(s.nextStaffId++, cand);
      s.staff.push(rec);
      this.addCrew(rec);
      s.candidates[idx] = RC.state.makeCandidate(this.rng, s.staff.map((m) => m.name));
      return this.done();
    }

    refreshCandidates() {
      const s = this.s;
      if (s.coins < 30) return this.fail('金幣不足');
      s.coins -= 30;
      s.candidates = [0, 1, 2].map(() => RC.state.makeCandidate(this.rng, s.staff.map((m) => m.name)));
      return this.done();
    }

    fire(id) {
      const s = this.s;
      if (s.staff.length <= 1) return this.fail('至少要留一位員工');
      const m = this.crewById(id);
      if (!m) return this.fail('找不到員工');
      this.abortJob(m);
      this.crew = this.crew.filter((x) => x !== m);
      s.staff = s.staff.filter((x) => x.id !== id);
      return this.done();
    }

    feed(id) {
      const m = this.crewById(id);
      if (!m) return this.fail('找不到員工');
      if (m.rec.energy >= 95) return this.fail('體力還很充沛');
      if (this.s.coins < D.FEED_COST) return this.fail('金幣不足');
      this.s.coins -= D.FEED_COST;
      m.rec.energy = Math.min(100, m.rec.energy + D.FEED_AMOUNT);
      if (m.state === 'rest' && m.rec.energy >= REST_UNTIL) m.state = 'idle';
      return this.done();
    }

    renameRestaurant(name) {
      name = String(name || '').trim().slice(0, 12);
      if (!name) return this.fail('名字不能是空的');
      this.s.name = name;
      return this.done();
    }

    /** 點擊桌上的金幣堆 */
    collect(tx, ty) {
      const key = tx + ',' + ty;
      const amt = this.s.drops[key];
      if (!amt) return this.fail('沒有金幣');
      delete this.s.drops[key];
      this.s.stats.collects++;
      this.addCoins(amt, tx + 0.5, ty + 0.5);
      this.emit('collect', { auto: false });
      return this.done();
    }

    /* ───────── 任務 ───────── */

    countCat(...cats) {
      return this.s.items.filter((i) => cats.includes(D.furniture[i.id].cat)).length;
    }

    questProgress(q) {
      const s = this.s;
      switch (q.type) {
        case 'collect': return s.stats.collects;
        case 'chair': return this.countCat('chair');
        case 'table': return this.countCat('table');
        case 'stove': return this.countCat('stove');
        case 'decor': return this.countCat('decor', 'rug');
        case 'serve': return s.stats.served;
        case 'learn': return Object.keys(s.dishes).length;
        case 'staff': return s.staff.length;
        case 'level': return s.level;
        case 'stars': return this.stars;
        case 'earn': return s.stats.earned;
        case 'expand': return s.room.stage;
        case 'mastery': return Math.max(0, ...Object.values(s.dishes).map((d) => d.cooked));
        default: return 0;
      }
    }

    currentQuest() {
      const q = D.quests[this.s.quest.i];
      if (!q) return null;
      const progress = Math.min(q.n, this.questProgress(q));
      return { q, progress, done: progress >= q.n };
    }

    claimQuest() {
      const cur = this.currentQuest();
      if (!cur) return this.fail('沒有任務');
      if (!cur.done) return this.fail('任務還沒完成');
      this.s.coins += cur.q.reward;
      this.s.quest.i++;
      this.emit('questdone', cur.q);
      return this.done();
    }
  }

  RC.Game = Game;
})(typeof globalThis !== 'undefined' ? globalThis : window);
