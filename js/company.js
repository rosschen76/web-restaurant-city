/* 分店（公司）邏輯：開分店、總經理、雙店長制、調動員工、沒有被檢視的店「懶惰結算」、關店、連鎖崩壞。純邏輯，掛在 Game 上。
 *
 * 角色：
 *  - 只有一間店：玩家是店掌櫃（員工名單裡的 boss），什麼都做、不領薪水、只有他（與店長）能結帳。
 *  - 有了分店：玩家成為「總經理」（公司層的 co.gm），不屬於任何一間店。每間店（含主店）都實行雙店長制：
 *    正店長（Lv.10 以上，有結帳權限）＋副店長（Lv.8 以上；Lv.10 以上才有結帳權限）。
 *  - 玩家同一時間「檢視」一間店（可以調整格局、雇人、排班…）；其他店用懶惰結算。
 */
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

    /** 玩家是不是總經理（有分店之後） */
    isGM() {
      return !!this.s.company.gm;
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
      return co.stores.map((st) => {
        const head = st.staff.find((m) => m.head);
        const deputy = st.staff.find((m) => m.manager && !m.head);
        return {
          id: st.id,
          kind: st.kind,
          name: st.name,
          active: st === this.s,
          hasBoss: st.staff.some((m) => m.boss),
          staff: st.staff.filter((m) => !m.boss).length,
          head: head ? head.name : null,
          deputy: deputy ? deputy.name : null,
          deputyCanCollect: !!deputy && deputy.level >= D.DAY.managerLevel,
          canCollect: st.staff.some((m) => this.canCollect(m)),
          reputation: st.reputation,
          stars: this.storeStars(st),
          room: D.expansions[st.room.stage],
          report: st.report,
          pendingMin: st === this.s ? 0 : Math.max(0, co.gameMin - st.syncedMin),
        };
      });
    },

    /* ───────── 雙店長制 ───────── */

    /**
     * 補齊一間店的店長：正店長（Lv.10 以上）與副店長（Lv.8 以上），預設選綜合能力最強的員工。
     * 有店掌櫃（只有一間店、玩家自己當掌櫃）的店不自動任命，由玩家自己決定。回傳這次新任命的人。
     */
    ensureManagers(st) {
      st = st || this.s;
      if (st.staff.some((m) => m.boss)) return [];
      const best = (list) => list.sort((a, b) => this.abilityOf(b) - this.abilityOf(a) || a.id - b.id)[0];
      const named = [];
      if (!st.staff.some((m) => m.head)) {
        const pick = best(st.staff.filter((m) => !m.boss && m.level >= D.DAY.managerLevel));
        if (pick) {
          pick.manager = true;
          pick.head = true;
          named.push(pick.name + '（正店長）');
        }
      }
      if (!st.staff.some((m) => m.manager && !m.head)) {
        const pick = best(st.staff.filter((m) => !m.boss && !m.manager && m.level >= D.DAY.deputyLevel));
        if (pick) {
          pick.manager = true;
          pick.head = false;
          named.push(pick.name + '（副店長）');
        }
      }
      if (named.length && st === this.s) {
        if (st.schedule.auto) this.autoSchedule();
        this.toast(`任命 ${named.join('、')}`, 'info');
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
      const src = this.s.staff.filter((m) => !m.boss);
      const heads = src.filter((m) => m.level >= D.DAY.managerLevel);
      const deputies = src.filter((m) => m.level >= D.DAY.deputyLevel);
      const big = D.expansions[D.expansions.length - 1];
      const checks = [
        { key: 'limit', ok: n < D.BRANCH.max, text: `分店數量 ${n} / ${D.BRANCH.max}` },
        { key: 'room', ok: main.room.stage >= D.expansions.length - 1, text: `主店擴建到最大（${big.w}×${big.h}）` },
        { key: 'stars', ok: this.storeStars(main) >= D.MAX_STARS, text: `主店達到 ${D.MAX_STARS} 星` },
        { key: 'staff', ok: heads.length >= 2 && deputies.length >= 4, text: `這間店要有 2 位 Lv.${D.DAY.managerLevel} 以上、共 4 位 Lv.${D.DAY.deputyLevel} 以上的員工（派出正、副店長後，這間店也要有正、副店長）` },
        { key: 'cost', ok: this.s.coins >= cost, text: `開店資金 ${RC.util.fmt(cost)} 金幣` },
      ];
      return { ok: checks.every((c) => c.ok), checks, cost, heads, deputies };
    },

    /**
     * 開分店：指派一位 Lv.10 以上的員工當正店長、一位 Lv.8 以上的員工當副店長。
     * 第一間分店開張時，玩家成為總經理（不再是店掌櫃，原本那間店也改由正、副店長主持）。
     */
    openBranch(headId, deputyId, name) {
      const chk = this.branchCheck();
      const bad = chk.checks.find((c) => !c.ok);
      if (bad) return this.fail('還不能開分店：' + bad.text);
      const head = chk.heads.find((m) => m.id === headId);
      const deputy = chk.deputies.find((m) => m.id === deputyId);
      if (!head) return this.fail(`正店長要選一位 Lv.${D.DAY.managerLevel} 以上的員工`);
      if (!deputy) return this.fail(`副店長要選一位 Lv.${D.DAY.deputyLevel} 以上的員工`);
      if (head === deputy) return this.fail('正店長與副店長要是不同的人');
      const rest = this.s.staff.filter((m) => !m.boss && m !== head && m !== deputy);
      if (!rest.some((m) => m.level >= D.DAY.managerLevel) || rest.filter((m) => m.level >= D.DAY.deputyLevel).length < 2) return this.fail('派出去之後，這間店還要有 Lv.10 的正店長和 Lv.8 的副店長，請換人選');
      name = String(name || '').trim().slice(0, D.BRANCH.nameMax);
      if (!name) return this.fail('分店要取個名字');
      const co = this.s.company;
      if (co.stores.some((x) => x.name === name)) return this.fail('已經有同名的店了');
      this.s.coins -= chk.cost;
      if (!co.gm) this.becomeGM();
      this.s.staff = this.s.staff.filter((m) => m !== head && m !== deputy);
      for (const [rec, isHead] of [[head, true], [deputy, false]]) {
        rec.manager = true;
        rec.head = isHead;
        rec.shift = D.DAY.defaultOpen;
        rec.unpaid = 0;
      }
      const st = RC.state.newStore(co.nextStoreId++, name, [head, deputy], this.rng, { day: this.s.day, clock: this.s.clock });
      st.syncedMin = co.gameMin;
      RC.state.attach(st, co);
      RC.state.seedMenu(st, st.dishes, st.level, true, 0); // 新店只有瓦斯爐：先上架煮得動的菜，各備一天的料
      co.stores.push(st);
      this.syncCrew();
      for (const x of co.stores) if (x !== st) this.ensureManagers(x); // 原本那間店：由剩下的員工中 Lv.10 以上、綜合能力最強的接任正店長，再補副店長
      this.toast(`「${name}」開幕了！正店長 ${head.name}、副店長 ${deputy.name}`, 'good');
      this.emit('sfx', 'levelup');
      return this.done();
    },

    /** 玩家成為總經理：店掌櫃的身分搬到公司層，不再屬於任何一間店 */
    becomeGM() {
      const co = this.s.company;
      const main = co.stores[0];
      const boss = main.staff.find((m) => m.boss);
      if (boss) {
        co.gm = RC.state.cleanGm(boss);
        main.staff = main.staff.filter((m) => m !== boss);
      } else co.gm = RC.state.cleanGm({ id: co.core.nextStaffId++, name: '阿福', look: { skin: 1, hair: 0, hairStyle: 0, top: 7, pants: 0 }, speed: 1.15, skill: 1.1 });
      if (this.s === main) this.syncCrew();
      this.toast(`${co.gm.name} 成為總經理：不再屬於任何一間店，每間店由正、副店長主持`, 'info');
    },

    /** 分店都關了：總經理回到主店當店掌櫃 */
    returnToBoss() {
      const co = this.s.company;
      if (!co.gm) return;
      const main = co.stores[0];
      const boss = RC.state.newStaff(co.gm.id, { ...co.gm, boss: true, shift: D.DAY.defaultOpen });
      main.staff.unshift(boss);
      for (const m of main.staff) if (!m.boss) m.head = m.manager = false; // 回到單店：店長由玩家自己重新任命
      co.gm = null;
      co.chainDays = 0;
      if (this.s === main) this.syncCrew();
      this.toast(`${boss.name} 回到主店當店掌櫃`, 'info');
    },

    /* ───────── 檢視另一間店 ───────── */

    /** 離開一間店之前收尾：吃完在等結帳的客人直接結帳（沒有小費），免得白做工 */
    closeOut() {
      for (const c of this.customers.slice()) if (c.state === 'wait_pay') this.settle(c, { noTip: true });
    },

    /** 把畫面切到另一間店（目標店先補算到現在）。總經理不屬於任何一間店，所以隨時都可以切換。 */
    viewStore(target) {
      const co = this.s.company;
      const from = this.s;
      this.closeOut();
      this.settleStore(target);
      from.syncedMin = co.gameMin; // 離開的店從現在起由正、副店長主持，之後再補算
      co.activeId = target.id;
      this.loadStore(target);
      this.ensureManagers(target);
      if (target.schedule.auto) this.autoSchedule();
    },

    switchStore(id) {
      const co = this.s.company;
      const target = co.storeById(id);
      if (!target) return this.fail('找不到這間店');
      if (target === this.s) return this.fail('你已經在檢視這間店了');
      this.viewStore(target);
      return this.done(`前往「${target.name}」`);
    },

    /* ───────── 調動員工 ───────── */

    /** 把員工調到另一間店。調走後兩間店的店長缺額都會自動補上。 */
    transferStaff(staffId, toId) {
      const co = this.s.company;
      const to = co.storeById(toId);
      const rec = this.s.staff.find((m) => m.id === staffId);
      if (!to || to === this.s) return this.fail('找不到要調去的店');
      if (!rec) return this.fail('找不到員工');
      if (rec.boss) return this.fail('店掌櫃是你自己，不能調動');
      if (to.staff.filter((m) => !m.boss).length >= D.maxStaffForLevel(this.s.level)) return this.fail('那間店的員工人數已達上限');
      this.s.staff = this.s.staff.filter((m) => m !== rec);
      rec.manager = false;
      rec.head = false;
      rec.shift = D.DAY.defaultOpen;
      to.staff.push(rec);
      this.syncCrew();
      this.ensureManagers(this.s);
      this.ensureManagers(to);
      this.toast(`${rec.name} 調到「${to.name}」`, 'info');
      return this.done();
    },

    /* ───────── 沒有被檢視的店：懶惰結算 ───────── */

    /**
     * 把一間沒有被檢視的店補算到「現在」：暫時開一個 headless 的 Game，照那間店自己的設備與員工跑完這段時間。
     * 客流只有 80%；金幣、經驗直接進公司。回傳報告；分店風評崩壞會關店，主店崩壞整場遊戲結束。
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
      const g = new RC.Game(st, { seed: (st.id * 7919 + Math.floor(co.gameMin)) >>> 0, headless: true });
      g.quiet = true;
      g.ensureManagers(st); // 沒有掌櫃的店，先把店長缺額補上
      const before = { served: st.stats.served, earned: st.stats.earned };
      let wages = 0;
      let procure = 0;
      const pay = g.payWages;
      g.payWages = function () {
        procure += this.procureToday; // 午夜結算（會把今天的進貨花費歸零）之前先記下來
        const r = pay.apply(this, arguments);
        wages += r.paid + r.welfare + r.bonus;
        return r;
      };
      const abs0 = g.absMin();
      let guard = 0;
      while (g.absMin() - abs0 < pending && g.pendingClose == null && guard++ < 3e6) g.step(0.1);
      st.syncedMin += g.absMin() - abs0;
      if (st.over) {
        this.emit('gameover', st.over); // 沒被檢視的主店風評崩壞：整場遊戲結束
        return { id: st.id, name: st.name, closed: false, over: true };
      }
      if (g.pendingClose != null) {
        this.closeBranch(st.id, {}, 'reputation');
        return { id: st.id, name: st.name, closed: true };
      }
      st.report = {
        day: st.day,
        served: st.stats.served - before.served,
        earned: st.stats.earned - before.earned,
        wages,
        procure,
        reputation: st.reputation,
      };
      return { id: st.id, name: st.name, closed: false, ...st.report };
    },

    /** 全部沒有被檢視的店都補算（每天午夜、離線回來時） */
    settleDormant() {
      const reports = [];
      for (const st of this.stores().slice()) {
        if (st === this.s) continue;
        const r = this.settleStore(st);
        if (r && !r.closed && !r.over) reports.push(r);
      }
      for (const r of reports) if (r.served > 0 || r.earned > 0) this.toast(`「${r.name}」：服務 ${r.served} 位客人，營收 ${RC.util.fmt(r.earned)}，發出薪資與福利 ${RC.util.fmt(r.wages)}，進貨 ${RC.util.fmt(r.procure || 0)}`, 'info');
      if (reports.length) this.changed();
      return reports;
    },

    /* ───────── 連鎖崩壞 ───────── */

    /**
     * 所有分店（至少 2 間）的風評都低於 D.BRANCH.chainRep，連續 D.BRANCH.chainDays 天，視同主店倒閉、遊戲終止。
     * 每天午夜檢查一次。
     */
    checkChain() {
      const co = this.s.company;
      const br = co.stores.slice(1);
      if (br.length < D.BRANCH.chainMinBranches || !br.every((x) => x.reputation < D.BRANCH.chainRep)) {
        co.chainDays = 0;
        return;
      }
      co.chainDays++;
      if (co.chainDays >= D.BRANCH.chainDays) this.endCompany('chain');
      else if ([1, 5, 8, 9].includes(co.chainDays)) this.toast(`⚠ 所有分店的風評都低於 ${D.BRANCH.chainRep}，已連續 ${co.chainDays} 天，滿 ${D.BRANCH.chainDays} 天公司就要倒閉了！`, 'bad');
    },

    /** 整家公司倒閉（遊戲終止）。記在主店上，不管玩家正在檢視哪一間店。 */
    endCompany(reason) {
      const main = this.stores()[0];
      if (main.over) return;
      main.over = { day: this.s.day, reason, served: this.companyStat('served'), earned: this.companyStat('earned'), level: this.s.level };
      this.emit('gameover', main.over);
      this.changed();
    },

    /* ───────── 關店 ───────── */

    /** 資遣費：日薪的 D.BRANCH.severanceDays 倍 */
    severanceOf(rec) {
      return Math.round(this.wageOf(rec) * D.BRANCH.severanceDays);
    },

    /** 關閉分店前的預覽：家具入倉庫與賣出、每位員工可以調去哪裡或資遣 */
    planClose(id) {
      const co = this.s.company;
      const st = co.storeById(id);
      if (!st || st.kind !== 'branch') return null;
      const stored = Object.values(this.s.inventory).reduce((n, v) => n + v, 0);
      const room = Math.max(0, D.BRANCH.warehouseCap - stored);
      const items = st.items.slice().sort((a, b) => D.furniture[b.id].price - D.furniture[a.id].price); // 貴的優先入倉庫
      const keep = items.slice(0, room);
      const sell = items.slice(room);
      const cap = D.maxStaffForLevel(this.s.level);
      const others = co.stores.filter((x) => x !== st);
      const free = new Map(others.map((x) => [x.id, cap - x.staff.filter((m) => !m.boss).length]));
      const staff = st.staff
        .filter((m) => !m.boss)
        .map((m) => ({
          id: m.id,
          name: m.name,
          level: m.level,
          post: m.head ? '正店長' : m.manager ? '副店長' : '',
          severance: this.severanceOf(m),
          targets: others.filter((x) => free.get(x.id) > 0).map((x) => x.id),
        }));
      return {
        id,
        name: st.name,
        warehouse: { cap: D.BRANCH.warehouseCap, stored, room },
        items: { total: items.length, keep: keep.length, sell: sell.length, sellCoins: sell.reduce((n, it) => n + Math.floor(D.furniture[it.id].price / 2), 0), keepList: keep, sellList: sell },
        staff,
        others: others.map((x) => ({ id: x.id, name: x.name, free: free.get(x.id) })),
      };
    },

    /**
     * 關閉分店。opts.moves：{ 員工編號: 店面編號 | 'fire' }，沒指定的員工會優先調去還有名額的店，沒名額就資遣。
     * 資遣要加發資遣費（手動關店時由玩家出；風評崩壞自動關店不發）。家具先放倉庫（有容量上限），放不下的半價賣掉。
     */
    closeBranch(id, opts, reason) {
      opts = opts || {};
      reason = reason || 'manual';
      const co = this.s.company;
      const st = co.storeById(id);
      if (!st || st.kind !== 'branch') return this.fail('找不到這間分店');
      const plan = this.planClose(id);
      const cap = D.maxStaffForLevel(this.s.level);
      const room = new Map(plan.others.map((x) => [x.id, x.free]));
      // 每位員工的去向
      const moves = [];
      let severance = 0;
      for (const p of plan.staff) {
        let dest = opts.moves && opts.moves[p.id] !== undefined ? opts.moves[p.id] : null;
        if (dest === null) dest = plan.others.find((x) => room.get(x.id) > 0) ? plan.others.find((x) => room.get(x.id) > 0).id : 'fire';
        if (dest !== 'fire') {
          dest = +dest;
          if (!(room.get(dest) > 0)) {
            if (reason === 'manual') return this.fail(`「${(co.storeById(dest) || {}).name || '那間店'}」的員工名額不夠`);
            dest = 'fire';
          } else room.set(dest, room.get(dest) - 1);
        }
        moves.push([p, dest]);
        if (dest === 'fire' && reason === 'manual') severance += p.severance;
      }
      if (severance > this.s.coins) return this.fail(`資遣費 ${RC.util.fmt(severance)} 金幣不夠`);
      // 正在檢視這間店：先切回主店
      if (st === this.s) this.viewStore(co.stores[0]);
      // 家具：入倉庫或賣掉
      const inv = this.s.inventory;
      for (const it of plan.items.keepList) inv[it.id] = (inv[it.id] || 0) + 1;
      this.s.coins += plan.items.sellCoins;
      // 員工：調動或資遣
      const fired = [];
      for (const [p, dest] of moves) {
        const rec = st.staff.find((m) => m.id === p.id);
        if (!rec) continue;
        if (dest === 'fire') fired.push(rec);
        else {
          rec.manager = false;
          rec.head = false;
          rec.shift = D.DAY.defaultOpen;
          co.storeById(dest).staff.push(rec);
        }
      }
      this.s.coins -= severance;
      co.stores = co.stores.filter((x) => x !== st);
      if (co.stores.length === 1) this.returnToBoss();
      for (const x of co.stores) this.ensureManagers(x);
      if (this.s.company.stores.includes(this.s)) this.syncCrew();
      co.chainDays = 0;
      const parts = [`家具 ${plan.items.keep} 件入倉庫`];
      if (plan.items.sell) parts.push(`${plan.items.sell} 件倉庫放不下、賣得 ${RC.util.fmt(plan.items.sellCoins)}`);
      if (fired.length) parts.push(`資遣 ${fired.length} 位${severance ? `（資遣費 ${RC.util.fmt(severance)}）` : ''}`);
      this.toast(reason === 'reputation' ? `分店「${st.name}」風評跌到谷底太久，關門了：${parts.join('，')}` : `分店「${st.name}」已關閉：${parts.join('，')}`, 'bad');
      this.changed();
      return this.done();
    },

    /** 玩家正在檢視的分店在模擬中風評崩壞：這一輪結束後關店 */
    closePendingBranch() {
      const id = this.pendingClose;
      this.pendingClose = null;
      if (id != null) this.closeBranch(id, {}, 'reputation');
    },
  };

  for (const [k, v] of Object.entries(proto)) Object.defineProperty(Game.prototype, k, { value: v, writable: true, configurable: true });
})(typeof globalThis !== 'undefined' ? globalThis : window);
