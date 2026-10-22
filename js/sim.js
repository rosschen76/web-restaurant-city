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
  const CLEAN_TIME = 1.2; // 收拾一張桌子的時間（秒）
  const PAY_TIME = 0.8; // 店掌櫃電子支付收款的時間（秒）
  const PAY_TIP_WINDOW = 30; // 結帳等越久小費越少，等滿這麼久就沒有小費（秒）
  const PAY_TIMEOUT = 45; // 久等沒人來收就自助結帳（沒有小費），免得座位被卡死（秒）
  const REGISTER_DELAY = 1.5; // 有收銀機時，客人自助結帳前的等待（秒）
  const PL = D.PLATES;
  const DAYC = D.DAY;
  const WAGE_QUIT = D.WAGE_QUIT_DAYS;
  const REP = D.REPUTATION;
  const PAY_TIMEOUT_NO_PAYER = 12; // 沒有人能收款時（掌櫃與店長都下班），客人很快就自助結帳

  class Game {
    constructor(state, opts) {
      opts = opts || {};
      this.s = state;
      this.rng = makeRng(opts.seed != null ? opts.seed : (Date.now() & 0xffffffff) >>> 0);
      this.ev = new Emitter();
      this.speed = state.settings.speed || 1;
      this.pauseReasons = new Set(); // 暫停的原因可以疊加：'user' 玩家按暫停、'edit' 裝潢中、'settings' 設定面板開著
      this.customers = [];
      this.crew = [];
      this.nextCid = 1;
      this.stoveBusy = new Map(); // stove uid -> staff id
      this.seatTaken = new Map(); // chair uid -> customer id
      this.queue = []; // 門外候位的團體
      this.parties = []; // 已入座的團體
      this.tableParty = new Map(); // table uid -> party id（同一張桌子同時只給一組）
      this.nextPid = 1;
      this.lastPartySize = 1;
      this.quiet = false; // 離線快轉時不發事件
      this.dirty = new Map(); // table uid -> {x,y,plates,claimedBy} 客人離席後桌上的餐具
      // dayMode=false：不分日夜、不排班（所有人隨時待命、永遠營業）；測試用，正式遊戲一律開啟
      this.dayMode = opts.dayMode !== false;
      this.payerOn = true; // 目前有沒有人能替客人結帳（掌櫃或值班店長在班）
      this.offline = false; // 離線快轉中：不累計風評谷底天數、不會觸發遊戲終止
      this.dayMark = { served: state.stats.served, earned: state.stats.earned };
      this.sinkBusy = new Map(); // sink uid -> 正在洗碗的員工 id
      this.spawnTimer = 3;
      this.autosaveTimer = 0;
      this.rebuild();
      for (const rec of state.staff) this.addCrew(rec);
      this.wasOpen = this.isOpen();
      this.updateDuty();
    }

    /** 只要有任何一個暫停原因，遊戲時間就完全凍結。 */
    get paused() {
      return this.pauseReasons.size > 0;
    }
    /** 相容寫法：paused = true 視為玩家手動暫停；= false 解除所有暫停。 */
    set paused(v) {
      if (v) this.pauseReasons.add('user');
      else this.pauseReasons.clear();
    }
    setPause(reason, on) {
      if (on) this.pauseReasons.add(reason);
      else this.pauseReasons.delete(reason);
      this.changed();
    }
    isPausedBy(reason) {
      return this.pauseReasons.has(reason);
    }

    on(name, fn) {
      return this.ev.on(name, fn);
    }
    emit(name, a, b) {
      if (!this.quiet) this.ev.emit(name, a, b);
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
      // 每張桌子的座位數（團體以桌為單位入座）
      this.tables = new Map();
      for (const seat of this.seats) {
        if (!this.tables.has(seat.tableUid)) this.tables.set(seat.tableUid, { uid: seat.tableUid, seats: [] });
        this.tables.get(seat.tableUid).seats.push(seat);
      }
      for (const t of this.tables.values()) {
        const it = s.items.find((i) => i.uid === t.uid);
        const fp = W.footprint(RC.data.furniture[it.id], it.rot);
        t.access = [];
        for (let dy = 0; dy < fp.h; dy++)
          for (let dx = 0; dx < fp.w; dx++)
            for (let d = 0; d < 4; d++) {
              const nx = it.x + dx + DX[d];
              const ny = it.y + dy + DY[d];
              if (W.walkable(this.grid, nx, ny) && this.grid.reach[ny * this.grid.w + nx] && !t.access.some((a) => a.x === nx && a.y === ny)) t.access.push({ x: nx, y: ny });
            }
      }
      this.maxTableCap = 0;
      for (const t of this.tables.values()) this.maxTableCap = Math.max(this.maxTableCap, t.seats.length);
      for (const uid of [...this.dirty.keys()]) if (!this.tables.has(uid)) this.dirty.delete(uid);
      this.stoves = W.findStoves(this.grid);
      this.stoveByUid = new Map(this.stoves.map((x) => [x.uid, x]));
      this.sinks = W.findSinks(this.grid);
      this.sinkByUid = new Map(this.sinks.map((x) => [x.uid, x]));
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
      for (const c of this.customers.slice()) {
        if (c.state === 'leave') continue;
        if (c.state === 'leave') continue;
        const seat = this.seatByChair.get(c.seat);
        if (!seat) {
          this.sendParty(c.party, false, true);
          continue;
        }
        if (c.state === 'arrive') continue;
        if (c.state === 'enter') {
          const p = W.findPath(g, Math.floor(c.x), Math.floor(c.y), seat.x, seat.y);
          if (p) c.path = p;
          else this.sendParty(c.party, false, true);
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
      this.changed();
    }

    /* ───────── 數值公式 ───────── */

    dishInfo(id) {
      const d = D.dishes[id];
      const rec = this.s.dishes[id];
      const cooked = rec ? rec.cooked : 0;
      const m = D.masteryLevel(cooked);
      const price = Math.round(d.price * (1 + 0.08 * (m - 1)) * (1 + 0.1 * this.stars));
      return { def: d, mastery: m, cooked, price, learned: !!rec };
    }

    cookTime(dishId, stoveSpeed, skill) {
      const m = D.masteryLevel(this.s.dishes[dishId].cooked);
      const base = D.dishes[dishId].cook * (1 - 0.05 * (m - 1)) * (1 - this.fridgeBonus);
      return Math.max(1.2, base / (stoveSpeed * skill));
    }

    /** 現在的客流倍率：尖峰客人多、離峰客人少（不分日夜的測試模式固定為 1） */
    demand() {
      return this.dayMode ? D.demandAt(this.hour) : 1;
    }

    /** 現在是不是尖峰時段 */
    isPeak() {
      return this.dayMode && D.demandKind(D.demandAt(this.hour)) === 'peak';
    }

    spawnInterval() {
      const base = 9 / (1 + this.appeal / 50) / (1 + 0.04 * (this.s.level - 1));
      // 風評好客人上門更勤、風評差就變少（每 1 分 ±3%）
      const rep = Math.max(0.3, 1 + REP.arrivalEffect * this.s.reputation);
      return (clamp(base, 1.5, 9) * this.rng.range(0.7, 1.3)) / rep;
    }

    /* ───────── 員工 ───────── */

    addCrew(rec) {
      const spot = W.nearestWalkable(this.grid, 2, 2);
      const m = {
        rec,
        id: rec.id,
        boss: !!rec.boss,
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
        carryPlates: 0,
        sink: null,
        onDuty: this.onShift(rec), // 在班才會出現在店裡
        ending: false, // 下班時間到了，手上的事做完就走
        endingSince: 0,
        overtime: false,
        offSince: this.onShift(rec) ? 0 : this.absMin() - 24 * 60,
      };
      this.crew.push(m);
      return m;
    }

    /* ───────── 時鐘 / 營業 / 排班 ───────── */

    get hour() {
      return this.s.clock / 60;
    }
    /** 從第 1 天 00:00 起算的總分鐘數 */
    absMin() {
      return (this.s.day - 1) * 1440 + this.s.clock;
    }
    isOpen() {
      if (!this.dayMode) return true;
      const h = this.hour;
      return h >= this.s.schedule.open && h < this.s.schedule.close;
    }
    /** 這位員工現在是不是排定上班的時段（每班固定 8 小時） */
    onShift(rec) {
      if (!this.dayMode) return true;
      return (((this.hour - rec.shift) % 24) + 24) % 24 < DAYC.shiftHours;
    }
    anyOnDuty() {
      return this.crew.some((m) => m.onDuty && !m.ending);
    }
    canOpenDoor() {
      return !this.dayMode || (this.isOpen() && this.anyOnDuty());
    }
    adjustRep(d) {
      this.s.reputation = clamp(this.s.reputation + d, REP.min, REP.max);
    }

    clockIn(m) {
      const g = this.grid;
      m.onDuty = true;
      m.ending = false;
      m.x = g.door.x + 0.5;
      m.y = g.door.y + 0.5;
      m.path = [];
      m.state = 'idle';
      m.idleT = 0.5;
      this.emit('clockin', { id: m.id, name: m.rec.name });
    }
    clockOut(m, abs) {
      this.abortJob(m);
      m.onDuty = false;
      m.ending = false;
      m.overtime = false;
      m.offSince = abs;
      m.state = 'idle';
      m._sx = null;
      this.emit('clockout', { id: m.id, name: m.rec.name });
    }

    /** 依排班讓員工上下班；同時記下目前有沒有人能收款。 */
    updateDuty() {
      const abs = this.absMin();
      const closing = this.closingWork();
      let payer = false;
      for (const m of this.crew) {
        const want = this.onShift(m.rec);
        if (m.onDuty) {
          if (want) {
            m.ending = false;
            m.overtime = false;
          } else if (m.overtime && abs - m.endingSince >= DAYC.closeOvertimeMin) {
            this.clockOut(m, abs); // 收店加班已經到上限：不管手上的事，馬上下班
          } else if (closing) {
            // 班表結束時已經打烊、還有客人或餐具沒處理完：留下來把店收乾淨（加班有上限，不會無限留下）
            if (!m.overtime) {
              m.overtime = true;
              m.endingSince = abs;
            }
            m.ending = false;
          } else {
            if (!m.ending) {
              m.ending = true;
              m.endingSince = abs;
            }
            // 手上的事做完就下班；拖超過 30 分鐘就強制下班
            if (m.state === 'idle' || m.state === 'rest' || abs - m.endingSince >= 30) this.clockOut(m, abs);
          }
        } else if (want) this.clockIn(m);
        if (m.onDuty && !m.ending && (m.boss || m.rec.manager)) payer = true;
      }
      this.payerOn = payer;
    }

    /** 打烊後還有事沒做完：客人還在店裡（用餐、等結帳）、桌上有餐具、洗碗槽裡有髒盤子、手上還捧著餐具 */
    closingWork() {
      if (!this.dayMode || this.isOpen()) return false;
      return this.customers.length > 0 || this.dirty.size > 0 || this.s.sinkDirty > 0 || this.crew.some((m) => m.carryPlates > 0);
    }

    /** 往前走 dt 秒的時鐘；回傳這一步經過的遊戲分鐘數。 */
    advanceClock(dt) {
      const quiet = !this.isOpen() && this.customers.length === 0 && this.queue.length === 0;
      const chores = (this.dirty.size > 0 || this.s.sinkDirty > 0) && this.crew.some((m) => m.onDuty);
      const rate = (60 / DAYC.hourReal) * (quiet && !chores ? DAYC.nightFast : 1);
      const dm = dt * rate;
      this.s.clock += dm;
      if (this.s.clock >= 1440) {
        this.s.clock -= 1440;
        this.endDay();
      }
      const open = this.isOpen();
      if (open !== this.wasOpen) {
        this.wasOpen = open;
        this.onOpenChange(open);
      }
      // 離開崗位的員工：慢慢恢復體力，休息滿 2 小時直接補滿
      const abs = this.absMin();
      for (const m of this.crew) {
        if (m.onDuty) continue;
        m.rec.energy = Math.min(100, m.rec.energy + dm * 0.9);
        if (abs - m.offSince >= DAYC.restFullHours * 60) m.rec.energy = 100;
      }
      return dm;
    }

    onOpenChange(open) {
      if (open) {
        this.spawnTimer = Math.min(this.spawnTimer, 1);
        this.toast('開始營業了！', 'good');
      } else {
        this.queue = []; // 打烊：還在門外等位的客人離開（不算差評）
        this.toast('打烊了，把剩下的客人服務完吧', 'info');
      }
      this.changed();
    }

    /** 跨過午夜：結算一天、檢查風評、自動排班。 */
    endDay() {
      const s = this.s;
      const served = s.stats.served - this.dayMark.served;
      const earned = s.stats.earned - this.dayMark.earned;
      this.dayMark = { served: s.stats.served, earned: s.stats.earned };
      const wages = this.payWages();
      s.day++;
      this.emit('newday', { day: s.day, served, earned, wages: wages.paid, reputation: s.reputation });
      if (served > 0 || earned > 0 || wages.paid > 0) this.toast(`第 ${s.day - 1} 天結束：服務 ${served} 位客人，賺了 ${earned} 金幣${wages.paid > 0 ? `，發出日薪 ${wages.paid}` : ''}`, 'info');
      if (!this.offline) {
        // 風評連續停在谷底：滿 15 天餐廳就倒閉
        if (s.reputation <= REP.min + 1e-6) s.lowDays++;
        else s.lowDays = 0;
        if (s.lowDays >= REP.loseDays) this.endGame('reputation');
        else if (REP.warnDays.includes(s.lowDays)) this.toast(`⚠ 風評已連續 ${s.lowDays} 天跌到谷底，滿 ${REP.loseDays} 天餐廳就要倒閉了！`, 'bad');
      }
      if (s.schedule.auto) this.autoSchedule();
      this.changed();
    }

    /**
     * 午夜發日薪（店掌櫃不領）。金幣不夠就先發給編號小的員工；領不到的員工累計欠薪天數，
     * 連續 3 天沒領到薪水就離職（離線補算期間不會離職，回來後才會知道）。
     */
    payWages() {
      const s = this.s;
      let paid = 0;
      const quits = [];
      for (const rec of s.staff) {
        if (rec.boss || !(rec.wage > 0)) continue;
        if (s.coins >= rec.wage) {
          s.coins -= rec.wage;
          paid += rec.wage;
          rec.unpaid = 0;
        } else {
          rec.unpaid = Math.min(rec.unpaid + 1, WAGE_QUIT);
          if (!this.offline && rec.unpaid >= WAGE_QUIT) quits.push(rec);
          else this.toast(`⚠ 金幣不夠發薪水：${rec.name} 已經 ${rec.unpaid} 天沒領到薪水`, 'bad');
        }
      }
      for (const rec of quits) {
        this.fire(rec.id);
        this.toast(`${rec.name} 連續 ${WAGE_QUIT} 天領不到薪水，辭職了`, 'bad');
      }
      return { paid, quits: quits.length };
    }

    endGame(reason) {
      const s = this.s;
      if (s.over) return;
      s.over = { day: s.day, reason, served: s.stats.served, earned: s.stats.earned, level: s.level };
      this.emit('gameover', s.over);
      this.changed();
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
      if (m.cleanUid != null) {
        const d = this.dirty.get(m.cleanUid);
        if (d && d.claimedBy === m.id) d.claimedBy = null;
        m.cleanUid = null;
      }
      if (m.pay) {
        const pc = this.customerById(m.pay.cid);
        if (pc && pc.payBy === m.id) pc.payBy = null; // 客人還在等，會再派人來
        m.pay = null;
      }
      if (m.carryPlates) {
        this.s.sinkDirty += m.carryPlates; // 手上的髒盤子不能憑空消失
        m.carryPlates = 0;
      }
      if (m.sink != null) {
        if (this.sinkBusy.get(m.sink) === m.id) this.sinkBusy.delete(m.sink);
        m.sink = null;
      }
      m.job = null;
      m.stove = null;
      m.carry = null;
      m.path = [];
      if (m.state !== 'rest') m.state = 'idle';
      m.idleT = 0.3;
    }

    /* ───────── 餐具 ───────── */

    plateTotal() {
      return PL.base + PL.perSeat * this.seats.length;
    }

    /**
     * 乾淨的盤子 = 總數 − 各處「用掉」的：已預留給客人的、桌上已上菜的、桌上待收的、
     * 員工手上端著的、洗碗槽裡待洗的。全部由實際狀態推算，所以任何中途取消都不會讓盤子遺失。
     */
    cleanPlates() {
      let used = this.s.sinkDirty;
      for (const c of this.customers) if (c.plate) used++;
      for (const p of this.parties) used += p.dined;
      for (const d of this.dirty.values()) used += d.plates;
      for (const m of this.crew) used += m.carryPlates || 0;
      return Math.max(0, this.plateTotal() - used);
    }

    /* ───────── 客人 ───────── */

    queuePeople() {
      return this.queue.reduce((n, p) => n + p.size, 0);
    }

    /** 抽一個團體人數（不超過餐廳最大桌子的座位數）。 */
    pickPartySize() {
      const cap = Math.min(D.PARTY_MAX, this.maxTableCap);
      const w = D.PARTY_WEIGHTS.slice(0, cap);
      let r = this.rng.next() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < w.length; i++) {
        r -= w[i];
        if (r < 0) return i + 1;
      }
      return w.length;
    }

    /** 一組客人抵達：能立刻入座就入座，否則到門外候位；候位滿了就直接離開。 */
    trySpawn() {
      this.lastPartySize = 1;
      if (!this.stoves.length || !this.maxTableCap) return false;
      const size = this.pickPartySize();
      this.lastPartySize = size;
      const vipChance = clamp(0.015 + this.stars * 0.008, 0, 0.1);
      const vip = size === 1 && this.s.level >= 3 && this.rng.chance(vipChance);
      const party = {
        id: this.nextPid++,
        size,
        looks: Array.from({ length: size }, () => RC.state.makeLook(this.rng)),
        vip,
        vipTitle: vip ? this.rng.pick(D.VIP_TITLES) : null,
        p: 1,
        tableUid: null,
        dined: 0, // 實際上過菜的人數（有人用餐才需要收桌子）
      };
      this.queue.push(party);
      this.seatQueue();
      if (this.queue.includes(party) && this.queuePeople() > D.QUEUE_MAX_PEOPLE) {
        this.queue = this.queue.filter((x) => x !== party);
        this.s.stats.walkouts++;
        this.adjustRep(REP.turnaway * (this.isPeak() ? D.PEAK_REP_SHARE : 1));
        this.emit('turnaway', { size });
        return false;
      }
      this.changed();
      return true;
    }

    /**
     * 最小夠坐的空桌（桌子被別組佔用就不算空）。回傳 {table, seats}。
     * 座位本身也要沒人：搬動家具後，椅子可能改歸另一張桌子，但椅子上還坐著別組的客人。
     */
    findTable(size) {
      let best = null;
      for (const t of this.tables.values()) {
        if (this.tableParty.has(t.uid) || this.dirty.has(t.uid)) continue;
        const free = t.seats.filter((x) => !this.seatTaken.has(x.uid));
        if (free.length < size) continue;
        if (!best || free.length < best.seats.length) best = { table: t, seats: free };
      }
      return best;
    }

    /** 依抵達順序，讓有合適空桌的團體入座。 */
    seatQueue() {
      if (!this.stoves.length) return;
      for (const party of this.queue.slice()) {
        const found = this.findTable(party.size);
        if (found) this.seatParty(party, found.table, found.seats);
      }
    }

    seatParty(party, table, seats) {
      const g = this.grid;
      this.queue = this.queue.filter((x) => x !== party);
      this.tableParty.set(table.uid, party.id);
      party.tableUid = table.uid;
      this.parties.push(party);
      for (let i = 0; i < party.size; i++) {
        const seat = seats[i];
        const c = {
          id: this.nextCid++,
          party: party.id,
          look: party.looks[i],
          vip: party.vip,
          vipTitle: party.vipTitle,
          x: g.door.x + 0.5,
          y: g.door.y + 0.5,
          dir: 0,
          face: 0,
          path: [],
          state: 'arrive', // 同組成員依序從門口進場
          t: i * 0.6,
          seat: seat.uid,
          dish: null,
          p: 1,
          claimedBy: null,
          payBy: null, // 正在替他結帳的店掌櫃
          payWait: 0,
          rush: false, // 玩家點過，掌櫃優先處理
          mood: 'ok',
          fade: 0,
          eatTotal: 1,
        };
        this.seatTaken.set(seat.uid, c.id);
        this.customers.push(c);
      }
    }

    pickDish() {
      const learned = Object.keys(this.s.dishes);
      return this.rng.pick(learned);
    }

    /** 單一客人起身離開（不處理同組與統計）。 */
    startLeave(c, angry) {
      if (c.state === 'leave') return;
      if (c.claimedBy != null) {
        const m = this.crewById(c.claimedBy);
        if (m) this.abortJob(m);
      }
      if (c.payBy != null) {
        const boss = this.crewById(c.payBy);
        if (boss) this.abortJob(boss);
        c.payBy = null;
      }
      this.seatTaken.delete(c.seat);
      c.claimedBy = null;
      c.state = 'leave';
      c.t = 0;
      c.angry = !!angry;
      const g = this.grid;
      this.relocateIfBlocked(c);
      c.path = W.findPath(g, Math.floor(c.x), Math.floor(c.y), g.door.x, g.door.y);
      if (!c.path) c.path = [];
      c.dead = c.path.length === 0 && Math.floor(c.x) === g.door.x && Math.floor(c.y) === g.door.y;
    }

    /**
     * 整組離開（有人等太久氣走，或版面變動讓座位消失）。
     * 已經吃完、正在等結帳的人不受氣走影響，結完帳自己會走；版面變動（forced）則直接結清離開，不讓錢憑空消失。
     * 有人氣走時整組只記一次差評。
     */
    sendParty(partyId, angry, forced) {
      let at = null;
      for (const m of this.customers) {
        if (m.party !== partyId || m.state === 'leave') continue;
        const paying = m.state === 'wait_pay';
        if (paying && !forced) continue;
        at = at || m;
        if (paying) this.settle(m, { noTip: true });
        else this.startLeave(m, angry);
      }
      if (angry && at) {
        this.s.stats.angry++;
        this.adjustRep(REP.angry);
        this.emit('angry', { x: at.x, y: at.y });
      }
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
        case 'arrive': {
          c.fade = 0;
          c.t -= dt;
          if (c.t <= 0) {
            const g = this.grid;
            const path = seat && W.findPath(g, g.door.x, g.door.y, seat.x, seat.y);
            if (!path) this.sendParty(c.party, false);
            else {
              c.path = path;
              c.state = 'enter';
            }
          }
          break;
        }
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
        case 'wait_pay':
          c.payWait += dt;
          if (c.payBy == null) {
            if (this.hasRegister && c.payWait >= REGISTER_DELAY) this.settle(c, {}); // 收銀機：客人自助結帳
            else if (c.payWait >= (this.payerOn ? PAY_TIMEOUT : PAY_TIMEOUT_NO_PAYER)) this.settle(c, { noTip: true }); // 太久沒人收，自助結帳
          }
          break;
        case 'leave':
          c.t += dt;
          c.walking = false;
          if (this.follow(c, CUSTOMER_SPEED * 1.15, dt) || c.dead) c.gone = true;
          break;
        default:
      }
      if (c.state === 'wait_order' || c.state === 'wait_food') {
        c.mood = c.p > 0.55 ? 'happy' : c.p > 0.25 ? 'ok' : 'mad';
        if (c.p <= 0) this.sendParty(c.party, true);
      }
    }

    /** 吃完了：先坐著、頭上出現金幣符號，等店掌櫃來結帳；結完帳才會起身、座位才釋放。 */
    finishMeal(c) {
      const info = this.dishInfo(c.dish);
      const mult = c.vip ? 3 : 1;
      const speedBonus = clamp((c.servedP - 0.5) * 2, 0, 1); // 上菜越快小費越多
      c.bill = info.price * mult;
      c.tipBase = Math.round(info.price * 0.5 * speedBonus * mult);
      this.s.stats.served++;
      this.addXp(info.def.xp * mult);
      c.state = 'wait_pay';
      c.t = 0;
      c.payWait = 0;
      c.payBy = null;
      this.emit('served', { vip: c.vip, tip: c.tipBase });
      this.changed();
    }

    /** 收款完成：金幣入帳，客人起身離開（座位在這時才釋放）。 */
    settle(c, o) {
      o = o || {};
      const s = this.s;
      const fresh = o.noTip ? 0 : clamp(1 - c.payWait / PAY_TIP_WINDOW, 0, 1); // 等越久小費越少
      const tip = Math.round(c.tipBase * fresh);
      const total = c.bill + tip;
      s.stats.tips += tip;
      s.stats.collects++;
      c.paid = total;
      c.mood = 'happy';
      this.adjustRep(o.noTip ? REP.selfCheckout : REP.happy + REP.fastBonus * fresh);
      const boss = c.payBy != null ? this.crewById(c.payBy) : null;
      if (boss) {
        boss.pay = null;
        if (boss.state === 'to_pay' || boss.state === 'paying') {
          boss.state = 'idle';
          boss.path = [];
          boss.idleT = 0.2;
        }
      }
      c.payBy = null;
      this.addCoins(total, c.x, c.y);
      this.emit('collect', { auto: !boss });
      this.startLeave(c, false);
      this.changed();
    }

    /** 玩家點了等結帳的客人：店掌櫃優先去收他的錢。 */
    rushPay(cid) {
      const c = this.customerById(cid);
      if (!c || c.state !== 'wait_pay') return this.fail('這位客人還沒吃完');
      c.rush = true;
      return { ok: true };
    }

    /* ───────── 員工行為 ───────── */

    /**
     * 店掌櫃的本業：替吃完的客人結帳（電子支付）。只有他能收款，而且優先於其他工作。
     * 煮到一半或正在上菜時不打斷，免得浪費餐點。玩家點過的客人優先，其次是等最久的。
     */
    dispatchBoss() {
      if (this.hasRegister) return; // 有收銀機：客人自助結帳，掌櫃不用跑腿
      // 能收款的人：在班的店掌櫃與值班店長。煮到一半或上菜中的不打斷
      const free = ['idle', 'to_customer', 'taking', 'wait_stove', 'wait_plate', 'to_stove', 'to_clean', 'to_wash', 'washing'];
      const payers = this.crew.filter((m) => m.onDuty && !m.ending && (m.boss || m.rec.manager) && free.includes(m.state));
      if (!payers.length) return;
      const waiting = this.customers.filter((c) => c.state === 'wait_pay' && c.payBy == null);
      if (!waiting.length) return;
      waiting.sort((a, b) => (b.rush ? 1 : 0) - (a.rush ? 1 : 0) || b.payWait - a.payWait);
      for (const c of waiting) {
        if (!payers.length) return;
        const seat = this.seatByChair.get(c.seat);
        if (!seat) continue;
        let best = null;
        for (const m of payers) {
          const r = W.nearestReachable(this.grid, Math.floor(m.x), Math.floor(m.y), seat.access);
          if (r && (!best || r.path.length < best.path.length)) best = { m, ...r };
        }
        if (!best) continue;
        const m = best.m;
        this.abortJob(m);
        m.pay = { cid: c.id };
        c.payBy = m.id;
        m.state = 'to_pay';
        m.path = best.path;
        payers.splice(payers.indexOf(m), 1);
      }
    }

    /** 把待收拾的桌子分給閒置員工（含掌櫃）。 */
    dispatchClean(idle) {
      for (const [uid, d] of this.dirty) {
        if (!idle.length) return;
        if (d.claimedBy != null) continue;
        const t = this.tables.get(uid);
        if (!t) continue;
        let best = null;
        for (const m of idle) {
          const r = W.nearestReachable(this.grid, Math.floor(m.x), Math.floor(m.y), t.access);
          if (r && (!best || r.path.length < best.path.length)) best = { m, ...r };
        }
        if (!best) continue;
        const m = best.m;
        d.claimedBy = m.id;
        m.cleanUid = uid;
        m.state = 'to_clean';
        m.path = best.path;
        idle.splice(idle.indexOf(m), 1);
      }
    }

    nearestSink(m) {
      let best = null;
      for (const sk of this.sinks) {
        const r = W.nearestReachable(this.grid, Math.floor(m.x), Math.floor(m.y), sk.access);
        if (r && (!best || r.path.length < best.path.length)) best = r;
      }
      return best;
    }

    finishWash(m) {
      if (m.sink != null && this.sinkBusy.get(m.sink) === m.id) this.sinkBusy.delete(m.sink);
      m.sink = null;
      m.state = 'idle';
      m.idleT = 0.2;
    }

    /** 有更急的工作（客人等點餐、等結帳、候位等桌子）時，洗碗先放一邊。 */
    urgentWork(m) {
      if (this.customers.some((c) => c.state === 'wait_order' && c.claimedBy == null)) return true;
      if ((m.boss || m.rec.manager) && !this.hasRegister && this.customers.some((c) => c.state === 'wait_pay' && c.payBy == null)) return true;
      return this.queue.length > 0 && this.dirty.size > 0;
    }

    /** 把待洗的盤子分給閒置員工：一個洗碗槽同時只有一個人洗。 */
    dispatchWash(idle) {
      if (!this.sinks.length) return;
      let need = this.s.sinkDirty - this.sinkBusy.size;
      for (const sk of this.sinks) {
        if (need <= 0 || !idle.length) return;
        if (this.sinkBusy.has(sk.uid)) continue;
        let best = null;
        for (const m of idle) {
          const r = W.nearestReachable(this.grid, Math.floor(m.x), Math.floor(m.y), sk.access);
          if (r && (!best || r.path.length < best.path.length)) best = { m, ...r };
        }
        if (!best) continue;
        const m = best.m;
        this.sinkBusy.set(sk.uid, m.id);
        m.sink = sk.uid;
        m.state = 'to_wash';
        m.path = best.path;
        idle.splice(idle.indexOf(m), 1);
        need--;
      }
    }

    dispatch() {
      this.dispatchBoss();
      const plates = this.cleanPlates();
      // 盤子用完了：在等盤子的員工不能乾等（收桌子、洗碗也需要人手），先放下手上的單去處理餐具
      if (plates < 1 && (this.s.sinkDirty > 0 || this.dirty.size > 0)) for (const m of this.crew) if (m.state === 'wait_plate') this.abortJob(m);
      const idle = this.crew.filter((m) => m.onDuty && !m.ending && m.state === 'idle' && !m.job && m.rec.energy > REST_BELOW);
      if (!idle.length) return;
      // 盤子快不夠了：先處理餐具（收桌、洗碗）；有人在門外等位時，也先收桌子讓位子盡快空出來
      if (plates < 2 || this.queue.length) this.dispatchClean(idle);
      if (this.s.sinkDirty > 0 && plates < 2) this.dispatchWash(idle);
      // 沒有盤子就先不接新單（接了也煮不了）
      const waiting = plates < 1 ? [] : this.customers.filter((c) => c.state === 'wait_order' && c.claimedBy == null);
      waiting.sort((a, b) => a.p - b.p);
      for (const c of waiting) {
        if (!idle.length) break;
        const seat = this.seatByChair.get(c.seat);
        if (!seat) continue;
        let best = null;
        for (const m of idle) {
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
      }
      this.dispatchClean(idle);
      this.dispatchWash(idle);
    }

    claimStove(m) {
      if (this.cleanPlates() < 1) return false; // 沒有乾淨的盤子，要等人洗
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
      const c = m.job && this.customerById(m.job.cid);
      if (c) c.plate = true; // 預留一個盤子給這位客人
      return true;
    }

    /** 接單後找爐灶與盤子；找不到就等（等盤子或等爐灶）。 */
    tryClaim(m) {
      if (!this.claimStove(m)) m.state = this.cleanPlates() < 1 ? 'wait_plate' : 'wait_stove';
    }

    stepStaff(m, dt) {
      const rec = m.rec;
      const spd = STAFF_SPEED * rec.speed;
      if (rec.boss) rec.energy = 100; // 店掌櫃是玩家本人，不會累
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
        case 'to_pay':
        case 'paying': {
          const pc = m.pay && this.customerById(m.pay.cid);
          if (!pc || pc.state !== 'wait_pay' || pc.payBy !== m.id) {
            this.abortJob(m);
            break;
          }
          if (m.state === 'to_pay') {
            if (this.follow(m, spd, dt)) {
              m.state = 'paying';
              m.payTotal = m.t = PAY_TIME / rec.speed;
              this.faceTo(m, pc);
            }
          } else {
            m.t -= dt;
            if (m.t <= 0) {
              this.settle(pc, {});
              m.pay = null;
              m.state = 'idle';
              m.idleT = 0.2;
            }
          }
          break;
        }
        case 'to_clean': {
          const t = this.tables.get(m.cleanUid);
          if (!t || !this.dirty.has(m.cleanUid)) {
            this.abortJob(m);
            break;
          }
          if (this.follow(m, spd, dt)) {
            m.state = 'cleaning';
            m.cleanTotal = m.t = CLEAN_TIME / rec.speed;
            m.dir = this.dirToward(m, t.seats[0].tx + 0.5, t.seats[0].ty + 0.5);
          }
          break;
        }
        case 'cleaning':
          m.t -= dt;
          if (!this.dirty.has(m.cleanUid)) {
            this.abortJob(m);
          } else if (m.t <= 0) {
            const d = this.dirty.get(m.cleanUid);
            this.dirty.delete(m.cleanUid);
            m.cleanUid = null;
            rec.energy = Math.max(0, rec.energy - 2);
            m.idleT = 0.3;
            this.emit('cleaned', { x: d.x + 0.5, y: d.y + 0.5 });
            // 收好的餐具端去洗碗槽（沒有洗碗槽就只能堆著，沒人洗得了）
            const r = d.plates > 0 && this.sinks.length ? this.nearestSink(m) : null;
            if (d.plates > 0 && !r) this.s.sinkDirty += d.plates;
            if (r) {
              m.carryPlates = d.plates;
              m.path = r.path;
              m.state = 'to_sink';
            } else m.state = 'idle';
            this.changed();
          }
          break;
        case 'to_sink':
          if (this.follow(m, spd, dt)) {
            m.state = 'dropping';
            m.t = PL.dropTime;
          }
          break;
        case 'dropping':
          m.t -= dt;
          if (m.t <= 0) {
            this.s.sinkDirty += m.carryPlates;
            m.carryPlates = 0;
            m.state = 'idle';
            m.idleT = 0.2;
            this.emit('plates', { x: m.x, y: m.y });
            this.changed();
          }
          break;
        case 'to_wash': {
          const sink = this.sinkByUid.get(m.sink);
          if (!sink) {
            this.abortJob(m);
            break;
          }
          if (this.follow(m, spd, dt)) {
            m.state = 'washing';
            m.washTotal = m.t = PL.washTime / rec.speed;
            m.dir = this.dirToward(m, sink.x + 0.5, sink.y + 0.5);
          }
          break;
        }
        case 'washing': {
          m.t -= dt;
          if (!(this.s.sinkDirty > 0) || !this.sinkByUid.has(m.sink)) {
            this.finishWash(m);
          } else if (m.t <= 0) {
            this.s.sinkDirty--; // 洗好一個盤子：乾淨盤子 +1（由 cleanPlates() 推算）
            rec.energy = Math.max(0, rec.energy - 0.4);
            this.emit('washed', { x: m.x, y: m.y });
            if (this.s.sinkDirty > 0 && !this.urgentWork(m)) m.t = m.washTotal;
            else this.finishWash(m);
            this.changed();
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
            this.tryClaim(m);
            m.t = 0.3;
          }
          break;
        case 'wait_stove':
        case 'wait_plate':
          m.t -= dt;
          if (m.t <= 0) {
            m.t = 0.3;
            this.tryClaim(m);
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
            const party = this.parties.find((x) => x.id === c.party);
            if (party) party.dined++;
            c.plate = false; // 這個盤子現在算在桌上（party.dined）
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
        this.toast(rec.name + ' 升到 Lv.' + rec.level + (rec.level === DAYC.managerLevel && !rec.boss ? '！可以任命為值班店長了' : '！'), 'good');
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
      if (this.paused || this.s.over) return;
      let left = Math.min(dtReal, 0.5) * this.speed;
      while (left > 1e-6) {
        const h = Math.min(left, 0.1);
        this.step(h);
        left -= h;
      }
    }

    step(dt) {
      this.s.stats.playTime += dt;
      if (this.dayMode) {
        this.advanceClock(dt);
        if (this.s.over) return; // 這一步剛好結束了遊戲
        this.updateDuty();
      }
      this.spawnTimer -= dt * this.demand(); // 倍率高的時段倒數得快，客人上門更勤
      if (this.spawnTimer <= 0) {
        if (this.canOpenDoor()) {
          this.trySpawn();
          // 一組來 n 人，下一組晚 n 倍時間抵達，整體客流量不隨人數變多而暴增
          this.spawnTimer = this.spawnInterval() * this.lastPartySize;
        } else this.spawnTimer = 1; // 還沒開店、已打烊，或根本沒人值班：客人不會上門
      }
      this.stepQueue(dt);
      for (const c of this.customers) this.stepCustomer(c, dt);
      this.customers = this.customers.filter((c) => !c.gone);
      // 整組都離席後才釋出桌子
      this.parties = this.parties.filter((p) => {
        const active = this.customers.some((c) => c.party === p.id && c.state !== 'leave');
        if (!active && this.tableParty.get(p.tableUid) === p.id) {
          this.tableParty.delete(p.tableUid);
          const t = this.tables.get(p.tableUid);
          if (p.dined > 0 && t) this.dirty.set(p.tableUid, { x: t.seats[0].tx, y: t.seats[0].ty, plates: p.dined, claimedBy: null });
        }
        return active;
      });
      this.dispatch();
      for (const m of this.crew) if (m.onDuty) this.stepStaff(m, dt);
    }

    /** 候位：耐心遞減、坐不下任何桌子的組別直接離開、有空桌就入座。 */
    stepQueue(dt) {
      if (!this.queue.length) return;
      const peak = this.isPeak();
      for (const party of this.queue.slice()) {
        party.p -= dt / (D.QUEUE_PATIENCE * (peak ? D.PEAK_PATIENCE : 1));
        if (party.p <= 0 || party.size > this.maxTableCap) {
          this.queue = this.queue.filter((x) => x !== party);
          this.s.stats.walkouts++;
          this.adjustRep(REP.walkout * (peak ? D.PEAK_REP_SHARE : 1));
          this.emit('walkout', { size: party.size });
        }
      }
      this.seatQueue();
    }

    /* ───────── 離線收益 ───────── */

    /**
     * 離開一段時間後回來：以真實模擬快轉（最多 8 小時、效率 50%）。
     * 離開不到 5 秒不處理；回傳報告（show=false 表示太短不必打擾玩家）。
     */
    catchUp(awaySeconds) {
      const O = D.OFFLINE;
      if (this.paused || this.s.over || !isFinite(awaySeconds) || awaySeconds < O.minAway) return null; // 裝潢暫停中時間不流動；已終止的遊戲不再進行
      const s = this.s;
      const real = Math.min(awaySeconds, O.maxHours * 3600);
      const simulated = real * O.efficiency;
      const before = { served: s.stats.served, earned: s.stats.earned, level: s.level, walkouts: s.stats.walkouts, angry: s.stats.angry, day: s.day, rep: s.reputation };
      this.quiet = true;
      this.offline = true; // 離線期間不會累計「風評谷底天數」，所以人不在的時候餐廳不會倒閉
      let left = simulated;
      while (left > 1e-6) {
        const h = Math.min(O.step, left);
        this.step(h);
        left -= h;
      }
      this.quiet = false;
      this.offline = false;
      this.dayMark = { served: s.stats.served, earned: s.stats.earned };
      let reward = 0;
      for (let lv = before.level + 1; lv <= s.level; lv++) reward += D.levelReward(lv);
      this.changed();
      return {
        show: awaySeconds >= O.minReport,
        away: awaySeconds,
        capped: awaySeconds > O.maxHours * 3600,
        simulated,
        served: s.stats.served - before.served,
        earned: s.stats.earned - before.earned,
        levelFrom: before.level,
        levelTo: s.level,
        levelReward: reward,
        walkouts: s.stats.walkouts - before.walkouts,
        angry: s.stats.angry - before.angry,
        days: s.day - before.day,
        reputation: s.reputation,
        reputationDelta: s.reputation - before.rep,
      };
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
      if (s.staff.filter((m) => !m.boss).length >= D.maxStaffForLevel(s.level)) return this.fail('員工人數已達上限，升級可增加名額');
      // 不再一次買斷：雇用不用付錢，之後每天午夜發日薪。手上至少要有一天的薪水，免得第一天就發不出來
      const wage = RC.state.dailyWage(cand, s.staff.length);
      if (s.coins < wage) return this.fail(`金幣不足：至少要有一天的日薪 ${wage}`);
      // 新員工當下立刻開始第一個班（8 小時）；自動排班會在隔天重新規劃
      const rec = RC.state.newStaff(s.nextStaffId++, { ...cand, wage, shift: Math.floor(this.hour) % 24 });
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
      const m = this.crewById(id);
      if (!m) return this.fail('找不到員工');
      if (m.boss) return this.fail('店掌櫃就是你，不能開除');
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

    /* ───────── 營業時間 / 排班 / 值班店長 ───────── */

    setBusinessHours(open, close) {
      open = Math.floor(+open);
      close = Math.floor(+close);
      if (!(open >= 0 && open <= 23) || !(close >= 1 && close <= 24)) return this.fail('時間不正確');
      if (close <= open) return this.fail('打烊時間要比開店時間晚');
      this.s.schedule.open = open;
      this.s.schedule.close = close;
      if (this.s.schedule.auto) this.autoSchedule();
      this.wasOpen = this.isOpen();
      return this.done();
    }

    /** 手動排班：每位員工的班一律是「從這個整點起連續 8 小時」，不能更長。 */
    setShift(id, start) {
      const rec = this.s.staff.find((m) => m.id === id);
      start = Math.floor(+start);
      if (!rec) return this.fail('找不到員工');
      if (!(start >= 0 && start <= 23)) return this.fail('時間不正確');
      rec.shift = start;
      this.s.schedule.auto = false;
      return this.done();
    }

    setAutoSchedule(on) {
      this.s.schedule.auto = !!on;
      if (on) this.autoSchedule();
      return this.done();
    }

    /**
     * 自動排班：把 8 小時的班平均錯開，盡量蓋滿營業時間。
     * 掌櫃排開店班、值班店長排收店班（兩人都能結帳），其他員工依序補中間的班。
     */
    autoSchedule() {
      const s = this.s;
      const { open, close } = s.schedule;
      const len = close - open;
      const k = Math.max(1, Math.ceil(len / DAYC.shiftHours));
      const slots = [];
      for (let i = 0; i < k; i++) slots.push(k === 1 ? open : Math.round(open + (i * (len - DAYC.shiftHours)) / (k - 1)));
      const slotOrder = k === 1 ? [0] : [0, k - 1, ...Array.from({ length: Math.max(0, k - 2) }, (_, i) => i + 1)];
      const people = [...s.staff].sort((a, b) => (b.boss ? 2 : b.manager ? 1 : 0) - (a.boss ? 2 : a.manager ? 1 : 0) || a.id - b.id);
      const count = Array(24).fill(0); // 各鐘點已經排了幾個人
      const cover = (start) => {
        for (let j = 0; j < DAYC.shiftHours; j++) count[(start + j) % 24]++;
      };
      people.forEach((rec, i) => {
        if (i < k) {
          rec.shift = ((slots[slotOrder[i]] % 24) + 24) % 24; // 先排滿營業時間
        } else {
          // 多出來的人：排在人手最吃緊的尖峰（客流倍率高、已經排的人少）
          let best = open;
          let bestScore = -1;
          for (let st = open; st <= Math.max(open, close - DAYC.shiftHours); st++) {
            let score = 0;
            for (let h = Math.max(st, open); h < Math.min(st + DAYC.shiftHours, close); h++) score += D.DEMAND[h % 24] / (1 + count[h % 24]);
            if (score > bestScore + 1e-9) {
              bestScore = score;
              best = st;
            }
          }
          rec.shift = ((best % 24) + 24) % 24;
        }
        cover(rec.shift);
      });
    }

    /** 每個鐘點（0~23）有幾位員工在班、其中幾位能收款；以及是否營業時段。 */
    coverage() {
      const s = this.s;
      const staff = Array(24).fill(0);
      const payers = Array(24).fill(0);
      const open = Array(24).fill(false);
      for (let h = 0; h < 24; h++) {
        open[h] = h >= s.schedule.open && h < s.schedule.close;
        for (const rec of s.staff) {
          if ((((h - rec.shift) % 24) + 24) % 24 < DAYC.shiftHours) {
            staff[h]++;
            if (rec.boss || rec.manager) payers[h]++;
          }
        }
      }
      return { staff, payers, open };
    }

    assignManager(id) {
      const s = this.s;
      const rec = s.staff.find((m) => m.id === id);
      if (!rec) return this.fail('找不到員工');
      if (rec.boss) return this.fail('店掌櫃本來就能結帳');
      if (rec.level < DAYC.managerLevel) return this.fail(`要達到 Lv.${DAYC.managerLevel} 才能任命值班店長`);
      for (const m of s.staff) m.manager = false;
      rec.manager = true;
      if (s.schedule.auto) this.autoSchedule();
      return this.done();
    }

    clearManager() {
      const rec = this.s.staff.find((m) => m.manager);
      if (!rec) return this.fail('目前沒有值班店長');
      rec.manager = false;
      if (this.s.schedule.auto) this.autoSchedule();
      return this.done();
    }

    renameBoss(name) {
      name = String(name || '').trim().slice(0, 8);
      if (!name) return this.fail('名字不能是空的');
      const boss = this.s.staff.find((m) => m.boss);
      if (!boss) return this.fail('找不到店掌櫃');
      boss.name = name;
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
        case 'decor': return this.countCat('decor');
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
