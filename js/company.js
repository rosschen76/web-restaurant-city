/* 分店（公司）邏輯：開分店、調動員工、玩家搬家、沒有玩家的店「懶惰結算」、分店倒閉。純邏輯，掛在 Game 上。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});
  const D = RC.data;
  const Game = RC.Game;

  const proto = {
    /* ───────── 查詢 ───────── */

    /** 綜合能力：速度＋技術（含加薪加成），用來挑店長 */
    abilityOf(rec) {
      return this.speedOf(rec) + this.skillOf(rec);
    },

    /** 全公司的店面（主店在最前面） */
    stores() {
      return this.s.company.stores;
    },

    storeStars(st) {
      return D.starsForAppeal(Game.appealOf(st).appeal);
    },

    /** 品牌聲譽：各店風評的平均 */
    brandReputation() {
      const ss = this.stores();
      return ss.reduce((n, x) => n + x.reputation, 0) / ss.length;
    },

    /** 給介面的店面摘要 */
    storeInfos() {
      const co = this.s.company;
      return co.stores.map((st) => ({
        id: st.id,
        kind: st.kind,
        name: st.name,
        active: st === this.s,
        hasPlayer: st.staff.some((m) => m.boss),
        staff: st.staff.filter((m) => !m.boss).length,
        managers: st.staff.filter((m) => m.manager).map((m) => m.name),
        reputation: st.reputation,
        stars: this.storeStars(st),
        room: D.expansions[st.room.stage],
        report: st.report,
        pendingMin: st === this.s ? 0 : Math.max(0, co.gameMin - st.syncedMin),
      }));
    },

    /* ───────── 店長 ───────── */

    /**
     * 讓一間店有足夠的值班店長：預設選 Lv.10 以上、綜合能力最強的員工。
     * 有玩家（掌櫃）在的店至少要 1 位；玩家不在的店盡量湊到 2 位（才蓋得滿 16 小時）。
     */
    ensureManagers(st) {
      st = st || this.s;
      const hasPlayer = st.staff.some((m) => m.boss);
      const need = hasPlayer ? 1 : D.DAY.maxManagers;
      let count = st.staff.filter((m) => m.manager).length;
      const picks = st.staff.filter((m) => !m.boss && !m.manager && m.level >= D.DAY.managerLevel).sort((a, b) => this.abilityOf(b) - this.abilityOf(a) || a.id - b.id);
      const named = [];
      while (count < need && picks.length) {
        const m = picks.shift();
        m.manager = true;
        count++;
        named.push(m.name);
      }
      if (named.length && st === this.s) {
        if (st.schedule.auto) this.autoSchedule();
        this.toast(`${named.join('、')} 被任命為值班店長`, 'info');
      }
      return named;
    },

    /* ───────── 開分店 ───────── */

    /** 開分店的條件與費用 */
    branchCheck() {
      const co = this.s.company;
      const main = co.stores[0];
      const n = co.stores.length - 1;
      const cost = D.BRANCH.cost[Math.min(n, D.BRANCH.cost.length - 1)];
      const eligible = this.s.staff.filter((m) => !m.boss && m.level >= D.DAY.managerLevel);
      const checks = [
        { key: 'limit', ok: n < D.BRANCH.max, text: `分店數量 ${n} / ${D.BRANCH.max}` },
        { key: 'room', ok: main.room.stage >= D.expansions.length - 1, text: `主店擴建到最大（${D.expansions[D.expansions.length - 1].w}×${D.expansions[D.expansions.length - 1].h}）` },
        { key: 'stars', ok: this.storeStars(main) >= D.MAX_STARS, text: `主店達到 ${D.MAX_STARS} 星` },
        { key: 'staff', ok: eligible.length > 0, text: `這間店有 Lv.${D.DAY.managerLevel} 以上的員工可以派去當店長` },
        { key: 'cost', ok: this.s.coins >= cost, text: `開店資金 ${RC.util.fmt(cost)} 金幣` },
      ];
      return { ok: checks.every((c) => c.ok), checks, cost, eligible };
    },

    /** 指派一位 Lv.10 以上的員工去開分店當店長。新店從頭開始（有起始設備），之後要自己雇人、擴建。 */
    openBranch(staffId, name) {
      const chk = this.branchCheck();
      const bad = chk.checks.find((c) => !c.ok);
      if (bad) return this.fail('還不能開分店：' + bad.text);
      const rec = chk.eligible.find((m) => m.id === staffId);
      if (!rec) return this.fail('請選一位 Lv.' + D.DAY.managerLevel + ' 以上的員工當店長');
      name = String(name || '').trim().slice(0, D.BRANCH.nameMax);
      if (!name) return this.fail('分店要取個名字');
      const co = this.s.company;
      if (co.stores.some((x) => x.name === name)) return this.fail('已經有同名的店了');
      this.s.coins -= chk.cost;
      this.s.staff = this.s.staff.filter((m) => m !== rec);
      rec.manager = true;
      rec.shift = D.DAY.defaultOpen;
      rec.unpaid = 0;
      const st = RC.state.newStore(co.nextStoreId++, name, rec, this.rng, { day: this.s.day, clock: this.s.clock });
      st.syncedMin = co.gameMin;
      RC.state.attach(st, co);
      co.stores.push(st);
      this.syncCrew();
      this.ensureManagers(this.s); // 店長走了：預設由 Lv.10 以上、綜合能力最強的員工接任
      this.toast(`「${name}」開幕了！店長是 ${rec.name}`, 'good');
      this.emit('sfx', 'levelup');
      return this.done();
    },

    /* ───────── 玩家搬家 ───────── */

    /** 離開一間店之前收尾：吃完在等結帳的客人直接結帳（沒有小費），免得白做工 */
    closeOut() {
      for (const c of this.customers.slice()) if (c.state === 'wait_pay') this.settle(c, { noTip: true });
    },

    /** 把玩家（店掌櫃）從目前的店搬到另一間店。目前這間店要有值班店長主持。 */
    switchStore(id) {
      const co = this.s.company;
      const target = co.storeById(id);
      if (!target) return this.fail('找不到這間店');
      if (target === this.s) return this.fail('你已經在這間店了');
      const from = this.s;
      this.ensureManagers(from);
      if (!from.staff.some((m) => !m.boss && m.manager)) return this.fail(`要先有一位 Lv.${D.DAY.managerLevel} 以上的員工當值班店長，這間店才能交給他`);
      this.closeOut();
      this.movePlayer(from, target);
      return this.done(`前往「${target.name}」`);
    },

    /** 實際搬移：目標店先補算到現在，再讓玩家進去、載入那間店。 */
    movePlayer(from, target) {
      const co = this.s.company;
      const boss = from.staff.find((m) => m.boss);
      this.settleStore(target); // 玩家還沒到：先把這段時間補算完
      if (boss) {
        from.staff = from.staff.filter((m) => m !== boss);
        boss.manager = false;
        target.staff.push(boss);
      }
      from.syncedMin = co.gameMin; // 離開的店從現在起由店長主持，之後再補算
      co.activeId = target.id;
      this.loadStore(target);
      if (target.schedule.auto) this.autoSchedule();
      this.ensureManagers(target);
    },

    /* ───────── 調動員工 ───────── */

    /** 把員工調到另一間店（不能調掌櫃）。調走後這間店若缺店長，會自動補上。 */
    transferStaff(staffId, toId) {
      const co = this.s.company;
      const to = co.storeById(toId);
      const rec = this.s.staff.find((m) => m.id === staffId);
      if (!to || to === this.s) return this.fail('找不到要調去的店');
      if (!rec) return this.fail('找不到員工');
      if (rec.boss) return this.fail('店掌櫃是你自己，要搬家請用「前往」');
      if (to.staff.filter((m) => !m.boss).length >= D.maxStaffForLevel(this.s.level)) return this.fail('那間店的員工人數已達上限');
      this.s.staff = this.s.staff.filter((m) => m !== rec);
      rec.manager = false;
      rec.shift = D.DAY.defaultOpen;
      to.staff.push(rec);
      this.syncCrew();
      this.ensureManagers(this.s);
      this.ensureManagers(to);
      this.toast(`${rec.name} 調到「${to.name}」`, 'info');
      return this.done();
    },

    /* ───────── 沒有玩家的店：懶惰結算 ───────── */

    /**
     * 把一間沒有玩家的店補算到「現在」：暫時開一個 headless 的 Game，照那間店自己的設備與員工跑完這段時間。
     * 客流只有 80%（沒有掌櫃坐鎮）；金幣、經驗直接進公司。回傳報告；分店風評崩壞會關店。
     */
    settleStore(st) {
      const co = this.s.company;
      if (st === this.s) return null;
      let pending = co.gameMin - st.syncedMin;
      if (!(pending >= 1)) return null;
      const cap = D.BRANCH.settleMaxDays * 1440;
      if (pending > cap) {
        st.syncedMin += pending - cap; // 太久以前的不補了
        pending = cap;
      }
      const g = new Game(st, { seed: (st.id * 7919 + Math.floor(co.gameMin)) >>> 0, headless: true });
      g.quiet = true;
      const before = { served: st.stats.served, earned: st.stats.earned };
      let wages = 0;
      const pay = g.payWages;
      g.payWages = function () {
        const r = pay.call(this);
        wages += r.paid;
        return r;
      };
      const abs0 = g.absMin();
      let guard = 0;
      while (g.absMin() - abs0 < pending && g.pendingClose == null && guard++ < 3e6) g.step(0.1);
      st.syncedMin += g.absMin() - abs0;
      if (st.over) {
        this.emit('gameover', st.over); // 玩家不在的主店風評崩壞：整場遊戲結束
        return { id: st.id, name: st.name, closed: false, over: true };
      }
      if (g.pendingClose != null) {
        this.closeBranch(st.id, 'reputation');
        return { id: st.id, name: st.name, closed: true };
      }
      st.report = {
        day: st.day,
        served: st.stats.served - before.served,
        earned: st.stats.earned - before.earned,
        wages,
        reputation: st.reputation,
      };
      return { id: st.id, name: st.name, closed: false, ...st.report };
    },

    /** 全部沒有玩家的店都補算（每天午夜、離線回來時） */
    settleDormant() {
      const reports = [];
      for (const st of this.stores().slice()) {
        if (st === this.s) continue;
        const r = this.settleStore(st);
        if (r && !r.closed) reports.push(r);
      }
      for (const r of reports) if (r.served > 0 || r.earned > 0) this.toast(`「${r.name}」：服務 ${r.served} 位客人，營收 ${RC.util.fmt(r.earned)}，發出日薪 ${RC.util.fmt(r.wages)}`, 'info');
      if (reports.length) this.changed();
      return reports;
    },

    /* ───────── 關店 ───────── */

    /** 玩家所在的分店在模擬中風評崩壞：這一輪結束後關店 */
    closePendingBranch() {
      const id = this.pendingClose;
      this.pendingClose = null;
      if (id != null) this.closeBranch(id, 'reputation');
    },

    /** 關閉分店：員工回主店（放不下的就解僱）、家具收進倉庫；玩家在那裡就搬回主店。 */
    closeBranch(id, reason) {
      const co = this.s.company;
      const st = co.storeById(id);
      if (!st || st.kind !== 'branch') return this.fail('找不到這間分店');
      const main = co.stores[0];
      if (st === this.s) this.movePlayer(st, main);
      const cap = D.maxStaffForLevel(this.s.level);
      for (const rec of st.staff.slice()) {
        if (rec.boss) continue;
        rec.manager = false;
        if (main.staff.filter((m) => !m.boss).length < cap) {
          rec.shift = D.DAY.defaultOpen;
          main.staff.push(rec);
        }
      }
      for (const it of st.items) this.s.inventory[it.id] = (this.s.inventory[it.id] || 0) + 1;
      co.stores = co.stores.filter((x) => x !== st);
      if (main === this.s) {
        this.syncCrew();
        this.ensureManagers(main);
      } else main.staff.length && this.ensureManagers(main);
      this.toast(reason === 'reputation' ? `分店「${st.name}」風評跌到谷底太久，關門了（員工回到主店、家具收進倉庫）` : `分店「${st.name}」已關閉`, 'bad');
      this.changed();
      return this.done();
    },
  };

  for (const [k, v] of Object.entries(proto)) Object.defineProperty(Game.prototype, k, { value: v, writable: true, configurable: true });
})(typeof globalThis !== 'undefined' ? globalThis : window);
