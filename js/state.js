/* 存檔資料結構、初始遊戲、載入驗證與儲存。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});
  const D = RC.data;

  const SAVE_KEY = 'pixel-restaurant-city/save';
  const SAVE_VERSION = D.GAME_VERSION.current;

  function makeLook(rng) {
    return {
      skin: rng.int(0, D.PALETTE.skin.length - 1),
      hair: rng.int(0, D.PALETTE.hair.length - 1),
      hairStyle: rng.int(0, 2),
      top: rng.int(0, D.PALETTE.top.length - 1),
      pants: rng.int(0, D.PALETTE.pants.length - 1),
    };
  }

  /** 應徵者：速度/技術 0.85~1.35，越強越貴 */
  function makeCandidate(rng, usedNames) {
    let name;
    const pool = D.STAFF_NAMES.filter((n) => !usedNames.includes(n));
    name = rng.pick(pool.length ? pool : D.STAFF_NAMES);
    const speed = Math.round(rng.range(0.85, 1.35) * 100) / 100;
    const skill = Math.round(rng.range(0.85, 1.35) * 100) / 100;
    return { name, look: makeLook(rng), speed, skill };
  }

  /** 日薪：依雇用當下的人數（含掌櫃）決定基本薪資，能力越強越貴；店掌櫃不領薪水 */
  function dailyWage(cand, staffCount) {
    const base = D.WAGE_BASE[Math.min(staffCount, D.WAGE_BASE.length - 1)];
    const q = (cand.speed + cand.skill) / 2;
    return Math.round((base * q * q) / 5) * 5;
  }

  function newStaff(id, cand) {
    return {
      id,
      name: cand.name,
      look: cand.look,
      speed: cand.speed,
      skill: cand.skill,
      level: 1,
      xp: 0,
      energy: 100,
      boss: !!cand.boss,
      shift: Number.isInteger(cand.shift) ? cand.shift : D.DAY.defaultOpen, // 上班時間（整點）：從這個鐘點起連續 8 小時
      manager: false, // 值班店長（Lv.10 起可任命）
      wage: cand.boss ? 0 : Math.max(0, Math.floor(+cand.wage || 0)), // 日薪（每天午夜發放）
      unpaid: 0, // 連續領不到薪水的天數
      raise: 0, // 加薪百分比（0～20）：日薪增加，速度與技術也提升
    };
  }

  /* ───────── 公司與店面 ─────────
   * 整個遊戲是一個「公司」：共用的欄位（金幣、等級、菜單、倉庫、任務…）存在公司層，
   * 每間店只有自己的欄位（格局、員工、風評…）。店面物件用存取器把共用欄位接到公司層，
   * 所以 s.coins、s.level 這些既有寫法完全不用改；JSON.stringify(店面) 仍會得到「單店的平面存檔」。 */
  const CORE_KEYS = ['v', 'coins', 'xp', 'level', 'owned', 'inventory', 'dishes', 'quest', 'nextStaffId', 'settings', 'flags', 'savedAt'];
  const STORE_KEYS = ['id', 'kind', 'name', 'room', 'items', 'nextUid', 'staff', 'candidates', 'schedule', 'reputation', 'lowDays', 'over', 'stats', 'sinkDirty', 'day', 'clock', 'syncedMin', 'report'];

  /** 把店面接上公司：共用欄位改成存取器（寫入公司層）。 */
  function attach(st, co) {
    for (const k of CORE_KEYS) {
      if (Object.prototype.hasOwnProperty.call(st, k) && !(Object.getOwnPropertyDescriptor(st, k).get)) co.core[k] = st[k]; // 第一次接上：把現有值搬到公司層
      Object.defineProperty(st, k, {
        get() {
          return co.core[k];
        },
        set(v) {
          co.core[k] = v;
        },
        enumerable: true,
        configurable: true,
      });
    }
    Object.defineProperty(st, 'company', { value: co, enumerable: false, configurable: true, writable: true });
    return st;
  }

  /** 建立公司：main 是主店。 */
  function link(main, hq) {
    hq = hq || {};
    const co = {
      core: {},
      stores: [main],
      gameMin: hq.gameMin || 0, // 整個公司累計經過的遊戲分鐘（由玩家所在的店推進）
      nextStoreId: hq.nextStoreId || 1,
      activeId: 0,
      get active() {
        return this.stores.find((x) => x.id === this.activeId) || this.stores[0];
      },
      storeById(id) {
        return this.stores.find((x) => x.id === id) || null;
      },
    };
    attach(main, co);
    return co;
  }

  /** 新店面的起始擺設：兩張桌各兩張椅、一座爐灶、一個洗碗槽、一盆小植物 */
  function starterItems(st) {
    const add = (id, x, y, rot) => st.items.push({ uid: st.nextUid++, id, x, y, rot: rot || 0 });
    add('stove_gas', 5, 0, 0);
    add('table_wood', 3, 4, 0);
    add('chair_stool', 2, 4, 0);
    add('chair_stool', 4, 4, 2);
    add('table_wood', 3, 6, 0);
    add('chair_stool', 2, 6, 0);
    add('chair_stool', 4, 6, 2);
    add('plant_pot', 7, 0, 0);
    add('sink', 3, 0, 0);
  }

  /** 一間新的分店（只有店面自己的欄位）。manager 是派去當店長的員工（已經整理好的員工物件）。 */
  function newStore(id, name, manager, rng, clockFrom) {
    rng = rng || RC.util.makeRng(Date.now());
    const st = {
      id,
      kind: 'branch',
      name: String(name || '分店').trim().slice(0, D.BRANCH.nameMax) || '分店',
      room: { stage: 0, floor: 'wood', wall: 'cream' },
      items: [],
      nextUid: 1,
      staff: manager ? [manager] : [],
      candidates: [],
      schedule: { open: D.DAY.defaultOpen, close: D.DAY.defaultClose, auto: true },
      reputation: 0,
      lowDays: 0,
      over: null,
      stats: { served: 0, angry: 0, walkouts: 0, earned: 0, collects: 0, tips: 0, playTime: 0 },
      sinkDirty: 0,
      day: clockFrom ? clockFrom.day : 1,
      clock: clockFrom ? clockFrom.clock : D.DAY.defaultOpen * 60,
      syncedMin: 0,
      report: null, // 最近一次結算的摘要
    };
    starterItems(st);
    for (let i = 0; i < 3; i++) st.candidates.push(makeCandidate(rng, st.staff.map((m) => m.name)));
    return st;
  }

  function newGame(rng) {
    rng = rng || RC.util.makeRng(Date.now());
    const first = {
      name: '阿福', // 店掌櫃：玩家本人，可在遊戲中改名
      look: { skin: 1, hair: 0, hairStyle: 0, top: 7, pants: 0 },
      speed: 1.15,
      skill: 1.1,
      boss: true,
      shift: D.DAY.defaultOpen,
    };
    const s = {
      v: SAVE_VERSION,
      id: 0,
      kind: 'main',
      syncedMin: 0,
      report: null,
      name: '我的小吃店',
      coins: 300,
      xp: 0,
      level: 1,
      room: { stage: 0, floor: 'wood', wall: 'cream' },
      owned: { floors: ['wood'], walls: ['cream'] },
      items: [],
      nextUid: 1,
      inventory: {},
      dishes: { danbing: { cooked: 0 } },
      staff: [newStaff(1, first)],
      nextStaffId: 2,
      candidates: [],
      quest: { i: 0 },
      sinkDirty: 0, // 洗碗槽裡等著洗的髒盤子
      day: 1,
      clock: D.DAY.defaultOpen * 60, // 一天中的第幾分鐘
      schedule: { open: D.DAY.defaultOpen, close: D.DAY.defaultClose, auto: true },
      reputation: 0,
      lowDays: 0, // 風評連續停在谷底的天數
      over: null, // 遊戲終止資訊
      stats: { served: 0, angry: 0, walkouts: 0, earned: 0, collects: 0, tips: 0, playTime: 0 },
      settings: { sound: true, music: true, sfxVol: 0.8, musicVol: 0.7, speed: 1 },
      flags: { welcomed: false },
      savedAt: 0,
    };
    starterItems(s);
    for (let i = 0; i < 3; i++) s.candidates.push(makeCandidate(rng, s.staff.map((m) => m.name)));
    link(s);
    return s;
  }

  const num = (v, d, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

  /** 物件：已知 id、座標在範圍內、不重疊。回傳 { items, nextUid, taken }。 */
  function cleanItems(rawItems, exp) {
    const items = [];
    let nextUid = 1;
    const taken = new Set();
    for (const it of Array.isArray(rawItems) ? rawItems : []) {
      const def = it && D.furniture[it.id];
      if (!def) continue;
      const rot = (Math.floor(num(it.rot, 0, 0, 3)) | 0) & 3;
      const fp = RC.world.footprint(def, rot);
      const x = Math.floor(num(it.x, -1, -1, 99));
      const y = Math.floor(num(it.y, -1, -1, 99));
      if (x < 0 || y < 0 || x + fp.w > exp.w || y + fp.h > exp.h) continue;
      const tiles = [];
      let bad = false;
      for (let dy = 0; dy < fp.h; dy++)
        for (let dx = 0; dx < fp.w; dx++) {
          const key = x + dx + ',' + (y + dy);
          if (taken.has(key) || (y + dy === D.DOOR_Y && x + dx <= 1)) bad = true;
          tiles.push(key);
        }
      if (bad) continue;
      tiles.forEach((k) => taken.add(k));
      items.push({ uid: nextUid++, id: def.id, x, y, rot });
    }
    return { items, nextUid, taken };
  }

  /** 員工名單：丟掉壞資料、補預設值。回傳 { staff, maxId }（wage 為 -1 代表舊存檔沒有日薪，由 fixStaffRoles 補上）。 */
  function cleanStaff(rawList) {
    const staff = [];
    let maxId = 0;
    for (const m of Array.isArray(rawList) ? rawList : []) {
      if (!m || typeof m.name !== 'string') continue;
      const id = Math.floor(num(m.id, 0, 1, 1e9));
      if (!id || staff.some((x) => x.id === id)) continue;
      const lk = m.look || {};
      staff.push({
        id,
        name: m.name.slice(0, 8),
        look: {
          skin: Math.floor(num(lk.skin, 0, 0, D.PALETTE.skin.length - 1)),
          hair: Math.floor(num(lk.hair, 0, 0, D.PALETTE.hair.length - 1)),
          hairStyle: Math.floor(num(lk.hairStyle, 0, 0, 2)),
          top: Math.floor(num(lk.top, 0, 0, D.PALETTE.top.length - 1)),
          pants: Math.floor(num(lk.pants, 0, 0, D.PALETTE.pants.length - 1)),
        },
        speed: num(m.speed, 1, 0.5, 2),
        skill: num(m.skill, 1, 0.5, 2),
        level: Math.floor(num(m.level, 1, 1, D.STAFF_XP_STEPS.length)),
        xp: Math.floor(num(m.xp, 0, 0, 1e9)),
        energy: num(m.energy, 100, 0, 100),
        boss: !!m.boss,
        shift: Math.floor(num(m.shift, D.DAY.defaultOpen, 0, 23)),
        manager: !!m.manager,
        wage: typeof m.wage === 'number' && isFinite(m.wage) ? Math.floor(num(m.wage, 0, 0, 1e6)) : -1,
        unpaid: Math.floor(num(m.unpaid, 0, 0, D.WAGE_QUIT_DAYS)),
        raise: Math.floor(num(m.raise, 0, 0, D.RAISE.max)),
      });
      maxId = Math.max(maxId, id);
    }
    return { staff, maxId };
  }

  /** 整理員工的角色：店掌櫃（hasBoss 為 true 時一定要有且只有一位、false 時沒有、null 時照存檔）、值班店長（最多 2 位、Lv.10 以上、不是掌櫃）、日薪 */
  function fixStaffRoles(staff, hasBoss) {
    if (hasBoss === true) {
      // 舊存檔沒有這個欄位：第一位員工就是掌櫃
      const first = staff.findIndex((m) => m.boss);
      staff.forEach((m, i) => (m.boss = i === (first < 0 ? 0 : first)));
    } else if (hasBoss === false) staff.forEach((m) => (m.boss = false));
    // hasBoss 為 null（分店）：掌櫃旗標照存檔，全公司只能有一位的規則最後統一整理
    let managers = 0;
    for (const m of staff) {
      if (m.manager && (m.boss || m.level < D.DAY.managerLevel || managers >= D.DAY.maxManagers)) m.manager = false;
      if (m.manager) managers++;
    }
    // 舊存檔的員工是一次買斷的：改成領日薪，依能力與到職順序補上（掌櫃不領薪水）
    staff.forEach((m, i) => {
      m.wage = m.boss ? 0 : m.wage >= 0 ? m.wage : dailyWage(m, i);
      if (m.boss) m.raise = 0; // 店掌櫃不領薪水，也沒有加薪
    });
  }

  /** 分店（只有店面自己的欄位）；壞資料回傳 null。 */
  function normalizeBranch(rb, co, rng) {
    if (!rb || typeof rb !== 'object') return null;
    const id = Math.floor(num(rb.id, 0, 1, 1e6));
    if (!id || co.stores.some((x) => x.id === id)) return null;
    const st = newStore(id, typeof rb.name === 'string' ? rb.name : '分店', null, rng);
    const owned = co.core.owned || { floors: ['wood'], walls: ['cream'] };
    const stage = Math.floor(num(rb.room && rb.room.stage, 0, 0, D.expansions.length - 1));
    st.room = { stage, floor: 'wood', wall: 'cream' };
    if (rb.room && owned.floors.includes(rb.room.floor)) st.room.floor = rb.room.floor;
    if (rb.room && owned.walls.includes(rb.room.wall)) st.room.wall = rb.room.wall;
    const cleaned = cleanItems(rb.items, D.expansions[stage]);
    st.items = cleaned.items;
    st.nextUid = cleaned.nextUid;
    if (!st.items.some((i) => i.id === 'sink')) {
      // 洗碗槽是必要設備：沒有就補一個放進最近的空格
      const exp = D.expansions[stage];
      outer: for (let y = 0; y < exp.h; y++) for (let x = 0; x < exp.w; x++) if (!cleaned.taken.has(x + ',' + y) && !(y === D.DOOR_Y && x <= 1)) {
        st.items.push({ uid: st.nextUid++, id: 'sink', x, y, rot: 0 });
        break outer;
      }
    }
    const { staff } = cleanStaff(rb.staff);
    fixStaffRoles(staff, null);
    st.staff = staff;
    if (Array.isArray(rb.candidates) && rb.candidates.length === 3) {
      st.candidates = rb.candidates.filter((c) => c && typeof c.name === 'string' && c.look).slice(0, 3).map((c) => ({ name: c.name.slice(0, 8), look: c.look, speed: num(c.speed, 1, 0.5, 2), skill: num(c.skill, 1, 0.5, 2) }));
      if (st.candidates.length !== 3) st.candidates = newStore(id, '', null, rng).candidates;
    }
    const sc = rb.schedule || {};
    const open = Math.floor(num(sc.open, D.DAY.defaultOpen, 0, 23));
    const close = Math.floor(num(sc.close, D.DAY.defaultClose, 1, 24));
    st.schedule = { open: close > open ? open : D.DAY.defaultOpen, close: close > open ? close : D.DAY.defaultClose, auto: sc.auto !== false };
    st.reputation = num(rb.reputation, 0, D.REPUTATION.min, D.REPUTATION.max);
    st.lowDays = Math.floor(num(rb.lowDays, 0, 0, 1e4));
    st.over = null; // 分店倒閉時就直接關掉了，存檔裡不會有「已倒閉的分店」
    const rs = rb.stats || {};
    st.stats = {
      served: Math.floor(num(rs.served, 0, 0, 1e9)),
      angry: Math.floor(num(rs.angry, 0, 0, 1e9)),
      walkouts: Math.floor(num(rs.walkouts, 0, 0, 1e9)),
      earned: Math.floor(num(rs.earned, 0, 0, 1e13)),
      collects: Math.floor(num(rs.collects, 0, 0, 1e9)),
      tips: Math.floor(num(rs.tips, 0, 0, 1e13)),
      playTime: num(rs.playTime, 0, 0, 1e10),
    };
    st.sinkDirty = Math.floor(num(rb.sinkDirty, 0, 0, 1e6));
    st.day = Math.floor(num(rb.day, 1, 1, 1e6));
    st.clock = num(rb.clock, D.DAY.defaultOpen * 60, 0, 1439.99);
    st.syncedMin = num(rb.syncedMin, 0, 0, 1e12);
    const rp = rb.report;
    st.report = rp && typeof rp === 'object' ? { day: Math.floor(num(rp.day, 1, 1, 1e6)), served: Math.floor(num(rp.served, 0, 0, 1e9)), earned: Math.floor(num(rp.earned, 0, 0, 1e13)), wages: Math.floor(num(rp.wages, 0, 0, 1e13)), reputation: num(rp.reputation, 0, D.REPUTATION.min, D.REPUTATION.max) } : null;
    attach(st, co);
    return st;
  }

  /** 把任意 JSON 整理成合法 state（缺欄位補預設、丟掉壞資料）。 */
  function normalize(raw, rng) {
    const base = newGame(rng);
    if (!raw || typeof raw !== 'object') return base;
    const s = base;
    s.name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 12) : s.name;
    s.coins = Math.floor(num(raw.coins, s.coins, 0, 1e12));
    s.level = Math.floor(num(raw.level, 1, 1, D.MAX_LEVEL));
    s.xp = Math.floor(num(raw.xp, 0, 0, 1e9));
    const st = Math.floor(num(raw.room && raw.room.stage, 0, 0, D.expansions.length - 1));
    s.room = { stage: st, floor: 'wood', wall: 'cream' };
    s.owned = { floors: ['wood'], walls: ['cream'] };
    if (raw.owned) {
      for (const f of raw.owned.floors || []) if (D.floors[f] && !s.owned.floors.includes(f)) s.owned.floors.push(f);
      for (const w of raw.owned.walls || []) if (D.walls[w] && !s.owned.walls.includes(w)) s.owned.walls.push(w);
    }
    if (raw.room) {
      if (s.owned.floors.includes(raw.room.floor)) s.room.floor = raw.room.floor;
      if (s.owned.walls.includes(raw.room.wall)) s.room.wall = raw.room.wall;
    }
    // 物件：已知 id、座標在範圍內、不重疊
    // 已取消的商品（地毯）：擺放中與倉庫裡的都按原價退款
    let refund = 0;
    for (const it of Array.isArray(raw.items) ? raw.items : []) if (it && D.LEGACY_REFUND[it.id]) refund += D.LEGACY_REFUND[it.id];
    for (const [id, n] of Object.entries(raw.inventory || {})) if (D.LEGACY_REFUND[id] && n > 0) refund += D.LEGACY_REFUND[id] * Math.floor(num(n, 0, 0, 9999));
    s.coins += refund;
    const exp = D.expansions[st];
    const cleaned = cleanItems(raw.items, exp);
    s.items = cleaned.items;
    s.nextUid = cleaned.nextUid;
    const taken = cleaned.taken;
    s.inventory = {};
    for (const [id, n] of Object.entries(raw.inventory || {})) if (D.furniture[id] && n > 0) s.inventory[id] = Math.floor(num(n, 0, 0, 9999));
    s.sinkDirty = Math.floor(num(raw.sinkDirty, 0, 0, 1e6));
    s.day = Math.floor(num(raw.day, 1, 1, 1e6));
    s.clock = num(raw.clock, D.DAY.defaultOpen * 60, 0, 1439.99);
    const sc = raw.schedule || {};
    const open = Math.floor(num(sc.open, D.DAY.defaultOpen, 0, 23));
    const close = Math.floor(num(sc.close, D.DAY.defaultClose, 1, 24));
    s.schedule = { open: close > open ? open : D.DAY.defaultOpen, close: close > open ? close : D.DAY.defaultClose, auto: sc.auto !== false };
    s.reputation = num(raw.reputation, 0, D.REPUTATION.min, D.REPUTATION.max);
    s.lowDays = Math.floor(num(raw.lowDays, 0, 0, 1e4));
    const ov = raw.over;
    s.over = ov && typeof ov === 'object' ? { day: Math.floor(num(ov.day, 1, 1, 1e6)), reason: 'reputation', served: Math.floor(num(ov.served, 0, 0, 1e9)), earned: Math.floor(num(ov.earned, 0, 0, 1e13)), level: Math.floor(num(ov.level, 1, 1, D.MAX_LEVEL)) } : null;
    // 舊存檔沒有洗碗槽：自動補一個（優先放在靠牆的一排；沒有空位就放進倉庫）
    if (!s.items.some((i) => i.id === 'sink') && !(s.inventory.sink > 0)) {
      let spot = null;
      for (let y = 0; y < exp.h && !spot; y++)
        for (let x = 0; x < exp.w && !spot; x++) if (!taken.has(x + ',' + y) && !(y === D.DOOR_Y && x <= 1)) spot = { x, y };
      if (spot) s.items.push({ uid: s.nextUid++, id: 'sink', x: spot.x, y: spot.y, rot: 0 });
      else s.inventory.sink = 1;
      s.flags.addedSink = true;
    }
    s.dishes = { danbing: { cooked: 0 } };
    for (const [id, v] of Object.entries(raw.dishes || {})) if (D.dishes[id]) s.dishes[id] = { cooked: Math.floor(num(v && v.cooked, 0, 0, 1e9)) };
    // 店掌櫃（玩家本人）如果搬去分店了，主店沒有掌櫃，名單可以是空的
    const hq = raw.hq && typeof raw.hq === 'object' ? raw.hq : null;
    const playerAway = !!(hq && Number.isInteger(hq.activeId) && hq.activeId > 0 && Array.isArray(raw.branches) && raw.branches.some((b) => b && b.id === hq.activeId));
    if (playerAway && Array.isArray(raw.staff)) s.staff = [];
    const { staff, maxId } = cleanStaff(raw.staff);
    if (staff.length) {
      fixStaffRoles(staff, !playerAway);
      s.staff = staff;
      s.nextStaffId = maxId + 1;
    }
    if (Array.isArray(raw.candidates) && raw.candidates.length) {
      const cs = raw.candidates
        .filter((c) => c && typeof c.name === 'string' && c.look)
        .slice(0, 3)
        .map((c) => ({ name: c.name.slice(0, 8), look: c.look, speed: num(c.speed, 1, 0.5, 2), skill: num(c.skill, 1, 0.5, 2) }));
      if (cs.length === 3) s.candidates = cs;
    }
    // 舊版把金幣留在桌上等玩家點擊；現在改為客人頭上結帳，舊存檔桌上未收的錢直接併入金幣
    for (const v of Object.values(raw.drops || {})) if (v > 0) s.coins += Math.floor(num(v, 0, 0, 1e9));
    s.quest = { i: Math.floor(num(raw.quest && raw.quest.i, 0, 0, D.quests.length)) };
    const rs = raw.stats || {};
    s.stats = {
      served: Math.floor(num(rs.served, 0, 0, 1e9)),
      angry: Math.floor(num(rs.angry, 0, 0, 1e9)),
      walkouts: Math.floor(num(rs.walkouts, 0, 0, 1e9)),
      earned: Math.floor(num(rs.earned, 0, 0, 1e13)),
      collects: Math.floor(num(rs.collects, 0, 0, 1e9)),
      tips: Math.floor(num(rs.tips, 0, 0, 1e13)),
      playTime: num(rs.playTime, 0, 0, 1e10),
    };
    const se = raw.settings || {};
    s.settings = {
      sound: se.sound !== false,
      music: se.music !== false,
      sfxVol: num(se.sfxVol, 0.8, 0, 1),
      musicVol: num(se.musicVol, 0.7, 0, 1),
      speed: [1, 2, 3].includes(se.speed) ? se.speed : 1,
    };
    s.flags = { welcomed: !!(raw.flags && raw.flags.welcomed), addedSink: s.flags.addedSink, sinkToldAt: raw.flags && raw.flags.sinkToldAt ? 1 : 0 };
    s.savedAt = num(raw.savedAt, 0, 0, 1e15);
    s.syncedMin = 0;
    // 分店
    const co = s.company;
    co.gameMin = num(hq && hq.gameMin, 0, 0, 1e12);
    for (const rb of Array.isArray(raw.branches) ? raw.branches.slice(0, D.BRANCH.max) : []) {
      const st = normalizeBranch(rb, co, rng);
      if (st) {
        st.syncedMin = Math.min(st.syncedMin, co.gameMin);
        co.stores.push(st);
      }
    }
    co.nextStoreId = Math.max(Math.floor(num(hq && hq.nextStoreId, 1, 1, 1e6)), ...co.stores.map((x) => x.id + 1));
    // 全公司只能有一位店掌櫃（玩家本人），他在哪間店，玩家就在哪間店
    const holders = co.stores.filter((x) => x.staff.some((m) => m.boss));
    let at = holders.find((x) => x.id === (hq && hq.activeId)) || holders[0];
    if (!at) {
      at = co.stores[0];
      if (at.staff.length) at.staff[0].boss = true;
    }
    for (const x of co.stores) if (x !== at) for (const m of x.staff) if (m.boss) m.boss = false;
    co.activeId = at.id;
    // 員工編號全公司不重複
    const allIds = co.stores.flatMap((x) => x.staff.map((m) => m.id));
    s.nextStaffId = Math.max(s.nextStaffId, ...allIds.map((i) => i + 1));
    return co.active;
  }

  /** 存檔字串（已編碼，見 codec.js）。savedAt 可指定，預設為現在。 */
  function serialize(state, savedAt) {
    const co = state && state.company;
    const out = { ...(co ? co.stores[0] : state), v: SAVE_VERSION, savedAt: savedAt != null ? savedAt : Date.now() }; // 主店的平面存檔（含共用欄位）
    if (co && co.stores.length > 1) {
      out.hq = { gameMin: co.gameMin, activeId: co.activeId, nextStoreId: co.nextStoreId };
      out.branches = co.stores.slice(1).map((st) => {
        const b = {};
        for (const k of STORE_KEYS) b[k] = st[k];
        return b;
      });
    } else if (co) out.hq = { gameMin: co.gameMin, activeId: 0, nextStoreId: co.nextStoreId };
    return RC.codec.encode(JSON.stringify(out));
  }

  /**
   * 檢查存檔版次。沒有版次欄位的視為版次 1（最早期的存檔）。
   * 回傳 { ok, version, reason }：reason 為 'old'（比目前舊太多）、'new'（比目前還新）或 'bad'。
   */
  function checkVersion(v) {
    const cur = D.GAME_VERSION.current;
    const ver = v === undefined || v === null ? 1 : v;
    if (typeof ver !== 'number' || !isFinite(ver) || ver < 1 || Math.floor(ver) !== ver) return { ok: false, version: ver, reason: 'bad' };
    if (ver > cur) return { ok: false, version: ver, reason: 'new' };
    if (cur - ver > D.GAME_VERSION.maxGap) return { ok: false, version: ver, reason: 'old' };
    return { ok: true, version: ver };
  }

  /** 版次不合時丟出的錯誤（帶有 code='version' 與檢查結果） */
  function versionError(chk) {
    const err = new Error(chk.reason === 'new' ? `存檔來自較新的版次 ${chk.version}（目前是 ${D.GAME_VERSION.current}）` : `存檔版次 ${chk.version} 與目前版次 ${D.GAME_VERSION.current} 差太多`);
    err.code = 'version';
    err.check = chk;
    return err;
  }

  /** 把 JSON 文字轉成 state：先確認版次再整理資料 */
  function fromJSON(plain, rng) {
    const raw = JSON.parse(plain);
    const chk = checkVersion(raw && typeof raw === 'object' ? raw.v : undefined);
    if (!chk.ok) throw versionError(chk);
    return normalize(raw, rng);
  }

  /** 解析存檔字串；格式不對、被改過或版次差太多會丟出錯誤。匯入玩家貼上的文字時只接受編碼過的格式。 */
  function parse(text, rng) {
    const plain = RC.codec.decode(text);
    if (plain === null) throw new Error('存檔格式不正確或已被修改');
    return fromJSON(plain, rng);
  }

  function getStorage() {
    try {
      return G.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  function save(state, storage) {
    storage = storage || getStorage();
    if (!storage) return false;
    try {
      storage.setItem(SAVE_KEY, serialize(state));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 讀檔；沒有存檔或壞檔時回傳 null。loadStatus 為 'none' | 'ok' | 'corrupt' | 'incompatible'（版次差太多）。
   * 讀不出來的存檔（損毀或被改過）會備份到另一個鍵再重新開始，不會直接消失。
   * 相容舊版（編碼機制上線前）的明文 JSON 存檔：讀取後下次存檔就會變成編碼格式。
   */
  function load(storage, rng) {
    state.loadStatus = 'none';
    state.loadInfo = null;
    storage = storage || getStorage();
    if (!storage) return null;
    let text = null;
    try {
      text = storage.getItem(SAVE_KEY);
      if (!text) return null;
      const st = text.trim().startsWith('{') ? fromJSON(text, rng) : parse(text, rng);
      state.loadStatus = 'ok';
      return st;
    } catch (e) {
      state.loadStatus = e && e.code === 'version' ? 'incompatible' : 'corrupt';
      state.loadInfo = e && e.check ? e.check : null;
      try {
        if (text) storage.setItem(SAVE_KEY + (state.loadStatus === 'incompatible' ? '/incompatible-backup' : '/corrupt-backup'), text);
      } catch (e2) {
        /* 備份失敗就算了 */
      }
      return null;
    }
  }

  function clear(storage) {
    storage = storage || getStorage();
    try {
      storage && storage.removeItem(SAVE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  const state = (RC.state = { loadStatus: 'none', loadInfo: null, SAVE_KEY, checkVersion, newGame, normalize, serialize, parse, save, load, clear, makeLook, makeCandidate, newStaff, newStore, attach, dailyWage, CORE_KEYS, STORE_KEYS });
})(typeof globalThis !== 'undefined' ? globalThis : window);
