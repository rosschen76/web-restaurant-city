/* 存檔資料結構、初始遊戲、載入驗證與儲存。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});
  const D = RC.data;

  const SAVE_KEY = 'pixel-restaurant-city/save';
  const SAVE_VERSION = 1;

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

  function hireCost(cand, staffCount) {
    const base = D.HIRE_BASE[Math.min(staffCount, D.HIRE_BASE.length - 1)];
    const q = (cand.speed + cand.skill) / 2;
    return Math.round((base * q * q) / 10) * 10;
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
    };
  }

  function newGame(rng) {
    rng = rng || RC.util.makeRng(Date.now());
    const first = {
      name: '阿福', // 店掌櫃：玩家本人，可在遊戲中改名
      look: { skin: 1, hair: 0, hairStyle: 0, top: 7, pants: 0 },
      speed: 1.15,
      skill: 1.1,
      boss: true,
    };
    const s = {
      v: SAVE_VERSION,
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
      stats: { served: 0, angry: 0, walkouts: 0, earned: 0, collects: 0, tips: 0, playTime: 0 },
      settings: { sound: true, music: true, speed: 1 },
      flags: { welcomed: false },
      savedAt: 0,
    };
    const add = (id, x, y, rot) => s.items.push({ uid: s.nextUid++, id, x, y, rot: rot || 0 });
    // 起始擺設：兩張桌各兩張椅（不併桌，所以至少要兩桌）、一座爐灶、一盆小植物
    add('stove_gas', 5, 0, 0);
    add('table_wood', 3, 4, 0);
    add('chair_stool', 2, 4, 0);
    add('chair_stool', 4, 4, 2);
    add('table_wood', 3, 6, 0);
    add('chair_stool', 2, 6, 0);
    add('chair_stool', 4, 6, 2);
    add('plant_pot', 7, 0, 0);
    for (let i = 0; i < 3; i++) s.candidates.push(makeCandidate(rng, s.staff.map((m) => m.name)));
    return s;
  }

  const num = (v, d, lo, hi) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

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
    s.items = [];
    s.nextUid = 1;
    const exp = D.expansions[st];
    const taken = new Set();
    for (const it of Array.isArray(raw.items) ? raw.items : []) {
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
      s.items.push({ uid: s.nextUid++, id: def.id, x, y, rot });
    }
    s.inventory = {};
    for (const [id, n] of Object.entries(raw.inventory || {})) if (D.furniture[id] && n > 0) s.inventory[id] = Math.floor(num(n, 0, 0, 9999));
    s.dishes = { danbing: { cooked: 0 } };
    for (const [id, v] of Object.entries(raw.dishes || {})) if (D.dishes[id]) s.dishes[id] = { cooked: Math.floor(num(v && v.cooked, 0, 0, 1e9)) };
    const staff = [];
    let maxId = 0;
    for (const m of Array.isArray(raw.staff) ? raw.staff : []) {
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
      });
      maxId = Math.max(maxId, id);
    }
    if (staff.length) {
      // 一定要有且只有一位店掌櫃（舊存檔沒有這個欄位：第一位員工就是掌櫃）
      const first = staff.findIndex((m) => m.boss);
      staff.forEach((m, i) => (m.boss = i === (first < 0 ? 0 : first)));
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
    s.settings = { sound: se.sound !== false, music: se.music !== false, speed: [1, 2, 3].includes(se.speed) ? se.speed : 1 };
    s.flags = { welcomed: !!(raw.flags && raw.flags.welcomed) };
    s.savedAt = num(raw.savedAt, 0, 0, 1e15);
    return s;
  }

  /** 存檔字串（已編碼，見 codec.js）。savedAt 可指定，預設為現在。 */
  function serialize(state, savedAt) {
    return RC.codec.encode(JSON.stringify({ ...state, v: SAVE_VERSION, savedAt: savedAt != null ? savedAt : Date.now() }));
  }

  /** 解析存檔字串；格式不對或被改過會丟出錯誤。匯入玩家貼上的文字時只接受編碼過的格式。 */
  function parse(text, rng) {
    const plain = RC.codec.decode(text);
    if (plain === null) throw new Error('存檔格式不正確或已被修改');
    return normalize(JSON.parse(plain), rng);
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
   * 讀檔；沒有存檔或壞檔時回傳 null。loadStatus 為 'none' | 'ok' | 'corrupt'。
   * 讀不出來的存檔（損毀或被改過）會備份到另一個鍵再重新開始，不會直接消失。
   * 相容舊版（編碼機制上線前）的明文 JSON 存檔：讀取後下次存檔就會變成編碼格式。
   */
  function load(storage, rng) {
    state.loadStatus = 'none';
    storage = storage || getStorage();
    if (!storage) return null;
    let text = null;
    try {
      text = storage.getItem(SAVE_KEY);
      if (!text) return null;
      const st = text.trim().startsWith('{') ? normalize(JSON.parse(text), rng) : parse(text, rng);
      state.loadStatus = 'ok';
      return st;
    } catch (e) {
      state.loadStatus = 'corrupt';
      try {
        if (text) storage.setItem(SAVE_KEY + '/corrupt-backup', text);
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

  const state = (RC.state = { loadStatus: 'none', SAVE_KEY, newGame, normalize, serialize, parse, save, load, clear, makeLook, makeCandidate, newStaff, hireCost });
})(typeof globalThis !== 'undefined' ? globalThis : window);
