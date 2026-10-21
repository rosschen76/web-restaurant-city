'use strict';
// 模糊測試：隨機擺放/移動/收起/賣出/旋轉家具 + 長時間模擬，檢查不變量。
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;

function invariants(g, label) {
  const ids = new Set(g.customers.map((c) => c.id));
  for (const [chair, cid] of g.seatTaken) {
    assert.ok(ids.has(cid), `${label}: seatTaken 指向不存在的客人 ${cid}`);
    assert.ok(g.s.items.some((i) => i.uid === chair), `${label}: 座位的椅子已不存在`);
  }
  const crewIds = new Set(g.crew.map((m) => m.id));
  for (const [stove, mid] of g.stoveBusy) {
    assert.ok(crewIds.has(mid), `${label}: stoveBusy 指向不存在的員工`);
    const m = g.crewById(mid);
    assert.equal(m.stove, stove, `${label}: 員工與爐灶預約不一致`);
  }
  for (const c of g.customers) {
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), `${label}: 客人座標 NaN`);
    assert.ok(c.p <= 1.0001);
    if (c.claimedBy != null) assert.ok(crewIds.has(c.claimedBy), `${label}: 客人被不存在的員工認領`);
  }
  for (const m of g.crew) {
    assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y), `${label}: 員工座標 NaN`);
    assert.ok(m.rec.energy >= 0 && m.rec.energy <= 100);
    if (m.job) {
      const c = g.customerById(m.job.cid);
      assert.ok(c && c.claimedBy === m.id, `${label}: 員工工作對象與認領不一致 (${m.state})`);
    }
  }
  assert.ok(g.customers.length <= Math.max(g.seats.length, 0) + g.customers.filter((c) => c.state === 'leave').length, `${label}: 客人數超過座位`);
  // 一張椅子只坐一個人；同組要嘛都在離開、要嘛都沒有
  const seated = g.customers.filter((c) => c.state !== 'leave').map((c) => c.seat);
  assert.equal(new Set(seated).size, seated.length, `${label}: 兩位客人坐同一張椅子`);
  // 離開的客人一定已付過錢（氣走的除外）；等結帳的客人座位必須仍被占用
  for (const c of g.customers) {
    if (c.state === 'wait_pay') assert.equal(g.seatTaken.get(c.seat), c.id, `${label}: 等結帳的客人座位被釋放了`);
    if (c.state === 'leave' && !c.angry && c.dish && c.t === 0) assert.ok(c.paid > 0 || c.party != null, `${label}: 沒付錢就離開`);
    if (c.payBy != null) {
      const b = g.crewById(c.payBy);
      assert.ok(b && b.boss && b.pay && b.pay.cid === c.id, `${label}: 結帳認領不一致`);
    }
  }
  assert.ok(g.queuePeople() <= RC.data.QUEUE_MAX_PEOPLE, `${label}: 候位超過上限`);
  // 桌子占用記錄必須指向還在場的團體
  const pids = new Set(g.parties.map((p) => p.id));
  for (const [, pid] of g.tableParty) assert.ok(pids.has(pid), `${label}: tableParty 指向不存在的團體`);
  // 收桌子 / 收錢的認領關係一致
  for (const [uid, d] of g.dirty) {
    assert.ok(g.tables.has(uid), `${label}: 髒桌子已不存在`);
    if (d.claimedBy != null) assert.equal(g.crewById(d.claimedBy) && g.crewById(d.claimedBy).cleanUid, uid, `${label}: 收桌認領不一致`);
  }
  for (const m of g.crew) {
    if (m.cleanUid != null) assert.equal(g.dirty.get(m.cleanUid) && g.dirty.get(m.cleanUid).claimedBy, m.id, `${label}: 員工收桌對象不一致`);
    if (m.pay) {
      assert.ok(m.boss, `${label}: 只有掌櫃能收款`);
      const pc = g.customerById(m.pay.cid);
      assert.ok(pc && pc.payBy === m.id, `${label}: 掌櫃收款對象不一致`);
    }
  }
  assert.ok(Number.isFinite(g.s.coins) && g.s.coins >= 0);
}

/** 座位不足時補一組「桌 + 左右椅」，讓營運真的跑起來 */
function ensureSeats(g, want) {
  const W = RC.world;
  let guard = 0;
  while (g.seats.length < want && guard++ < 6) {
    let placed = false;
    for (let y = 1; y < g.grid.h - 1 && !placed; y++)
      for (let x = 2; x < g.grid.w - 2 && !placed; x++) {
        const ok = (a, b) => W.canPlace(g.grid, D.furniture.table_wood, a, b, 0).ok;
        if (ok(x, y) && ok(x - 1, y) && ok(x + 1, y)) {
          for (const id of ['table_wood', 'chair_stool', 'chair_stool']) g.buyFurniture(id);
          g.placeFromInventory('table_wood', x, y, 0);
          g.placeFromInventory('chair_stool', x - 1, y, 0);
          g.placeFromInventory('chair_stool', x + 1, y, 2);
          placed = true;
        }
      }
    if (!placed) break;
  }
}

for (const seed of [1, 2, 3, 4, 5]) {
  test(`模糊測試 seed=${seed}：隨機改版面 + 營運 30 分鐘`, () => {
    const rng = RC.util.makeRng(seed * 7919);
    const s = RC.state.newGame(RC.util.makeRng(seed));
    s.coins = 200000;
    s.level = 20;
    for (const id of ['soymilk', 'fantuan', 'luroufan', 'boba', 'xiaolongbao']) s.dishes[id] = { cooked: 0 };
    const g = new RC.Game(s, { seed });
    g.hire(0);
    g.hire(1);
    g.s.room.stage = 2;
    g.rebuild();
    const catalog = D.furnitureList;
    const stuckStart = new Map();
    let t = 0;
    let actions = 0;
    while (t < 1800) {
      g.update(0.1);
      t += 0.1;
      if (Math.floor(t * 10) % 25 === 0) {
        const roll = rng.next();
        const grid = g.grid;
        const rx = rng.int(0, grid.w - 1);
        const ry = rng.int(0, grid.h - 1);
        const items = g.s.items;
        if (roll < 0.35) {
          const def = rng.pick(catalog);
          g.buyFurniture(def.id);
          g.placeFromInventory(def.id, rx, ry, rng.int(0, 3));
        } else if (roll < 0.55 && items.length) {
          const it = rng.pick(items);
          g.moveItem(it.uid, rx, ry, rng.int(0, 3));
        } else if (roll < 0.7 && items.length) {
          g.storeItem(rng.pick(items).uid);
        } else if (roll < 0.8 && items.length > 6) {
          g.sellItem(rng.pick(items).uid);
        } else if (roll < 0.9 && items.length) {
          g.rotateItem(rng.pick(items).uid);
        } else {
          ensureSeats(g, 3);
          // 保底：確保有桌椅爐灶，避免整場都在空轉
          if (!g.stoves.length) { g.buyFurniture('stove_gas'); for (let y = 0; y < grid.h; y++) for (let x = 0; x < grid.w; x++) if (g.placeFromInventory('stove_gas', x, y, 0).ok) { y = 99; break; } }
        }
        actions++;
        invariants(g, `t=${t.toFixed(1)}`);
      }
      // 卡死偵測：客人在「進場」或「等點餐」超過 120 秒（員工餓死/路徑問題）
      for (const c of g.customers) {
        const key = c.id + ':' + (c.state === 'enter' ? 'enter' : c.state === 'leave' ? 'leave' : '');
        if (c.state === 'enter' || c.state === 'leave') {
          if (!stuckStart.has(key)) stuckStart.set(key, t);
          assert.ok(t - stuckStart.get(key) < 90, `客人 ${c.id} 在 ${c.state} 狀態卡了 90 秒 (t=${t.toFixed(0)})`);
        }
      }
    }
    invariants(g, 'end');
    assert.ok(actions > 100);
    assert.ok(g.s.stats.served > 0, '30 分鐘內一位客人都沒服務到');
  });
}
