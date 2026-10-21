'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;

const mk = (seed = 1, mut) => {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  if (mut) mut(s);
  return new RC.Game(s, { seed });
};
const run = (g, sec, dt = 0.05) => {
  for (let t = 0; t < sec; t += dt) g.update(dt);
};

test('初始版面：有座位、有爐灶、門口可通行', () => {
  const g = mk();
  assert.equal(g.seats.length, 2);
  assert.equal(g.stoves.length, 1);
  assert.ok(g.grid.reach[D.DOOR_Y * g.grid.w + 0]);
});

test('A* 繞開障礙，並可走到被擋住的終點格', () => {
  const g = mk();
  const p = RC.world.findPath(g.grid, 0, 3, 7, 7);
  assert.ok(p && p.length === 11);
  const seat = g.seats[0];
  const q = RC.world.findPath(g.grid, 0, 3, seat.x, seat.y);
  assert.ok(q && q[q.length - 1].x === seat.x);
});

test('擺放檢查：重疊、越界、門口都會被拒絕', () => {
  const g = mk();
  const def = D.furniture.table_wood;
  assert.equal(RC.world.canPlace(g.grid, def, 3, 4, 0).ok, false); // 已有桌子
  assert.equal(RC.world.canPlace(g.grid, def, 8, 0, 0).ok, false); // 越界
  assert.equal(RC.world.canPlace(g.grid, def, 1, D.DOOR_Y, 0).ok, false); // 門口
  assert.equal(RC.world.canPlace(g.grid, D.furniture.table_long, 7, 7, 0).ok, false); // 2 格超出
  assert.equal(RC.world.canPlace(g.grid, def, 6, 6, 0).ok, true);
});

test('完整營運循環：客人入座 → 點餐 → 烹飪 → 上菜 → 付款 → 離開', () => {
  const g = mk(7);
  const served = [];
  g.on('served', () => served.push(1));
  run(g, 120);
  assert.ok(g.s.stats.served >= 3, '應該至少服務 3 位，實際 ' + g.s.stats.served);
  assert.ok(Object.values(g.s.drops).reduce((a, b) => a + b, 0) > 0, '桌上應有未收的金幣');
  assert.ok(g.s.dishes.danbing.cooked >= 3);
  assert.equal(served.length, g.s.stats.served);
});

test('點擊收款會入帳；收銀機則自動入帳', () => {
  const g = mk(7);
  run(g, 60);
  const key = Object.keys(g.s.drops)[0];
  assert.ok(key);
  const before = g.s.coins;
  const amt = g.s.drops[key];
  const [x, y] = key.split(',').map(Number);
  assert.equal(g.collect(x, y).ok, true);
  assert.equal(g.s.coins, before + amt);
  assert.equal(g.collect(x, y).ok, false);

  const g2 = mk(7, (s) => s.items.push({ uid: 99, id: 'register', x: 7, y: 7, rot: 0 }));
  run(g2, 60);
  assert.equal(Object.keys(g2.s.drops).length, 0);
  assert.ok(g2.s.stats.earned > 0);
});

test('沒有員工來點餐時客人會生氣離開，且釋放座位', () => {
  const g = mk(3);
  g.crew.forEach((m) => (m.rec.energy = 0)); // 員工都累癱
  g.crew.forEach((m) => (m.state = 'rest'));
  g.update(0.01);
  g.crew.forEach((m) => (m.rec.energy = 0));
  run(g, 25);
  // 強制不讓員工恢復
  g.crew.forEach((m) => { m.rec.energy = 0; m.state = 'rest'; });
  for (let i = 0; i < 700; i++) { g.crew.forEach((m) => { m.rec.energy = 0; m.state = 'rest'; }); g.update(0.1); }
  assert.ok(g.s.stats.angry >= 1);
  assert.ok(g.seatTaken.size <= g.seats.length);
});

test('移動家具時工作會被安全中止，客人不會卡死', () => {
  const g = mk(5);
  run(g, 20);
  const stove = g.s.items.find((i) => i.id === 'stove_gas');
  assert.equal(g.moveItem(stove.uid, 6, 0, 0).ok, true);
  const table = g.s.items.find((i) => i.id === 'table_wood');
  assert.equal(g.storeItem(table.uid).ok, true); // 沒桌子 → 沒座位
  assert.equal(g.seats.length, 0);
  run(g, 20);
  assert.equal(g.customers.length, 0, '所有客人都該離開');
  assert.equal(g.seatTaken.size, 0);
  assert.equal(g.stoveBusy.size, 0);
});

test('購買/擺放/出售流程與金幣', () => {
  const g = mk();
  assert.equal(g.buyFurniture('chair_wood').ok, true);
  assert.equal(g.s.coins, 300 - 45);
  assert.equal(g.placeFromInventory('chair_wood', 3, 5, 0).ok, true);
  assert.equal(g.seats.length, 3);
  assert.equal(g.placeFromInventory('chair_wood', 3, 5, 0).ok, false);
  assert.equal(g.buyFurniture('piano').ok, false); // 等級不夠
  const it = g.s.items.find((i) => i.x === 3 && i.y === 5);
  assert.equal(g.sellItem(it.uid).ok, true);
  assert.equal(g.s.coins, 300 - 45 + 22);
});

test('升級發放獎勵並回報解鎖內容', () => {
  const g = mk();
  let info = null;
  g.on('levelup', (e) => (info = e));
  g.addXp(D.xpForLevel(1));
  assert.equal(g.s.level, 2);
  assert.ok(info && info.reward === D.levelReward(2));
  assert.ok(info.unlocks.dishes.some((d) => d.id === 'fantuan'));
});

test('學菜、雇人、擴建的限制', () => {
  const g = mk();
  assert.equal(g.learnDish('soymilk').ok, true);
  assert.equal(g.learnDish('soymilk').ok, false);
  assert.equal(g.learnDish('fantuan').ok, false); // 2 級
  g.s.coins = 100000;
  g.s.level = 2;
  assert.equal(g.hire(0).ok, true);
  assert.equal(g.s.staff.length, 2);
  assert.equal(g.hire(0).ok, false); // 2 級只有 2 個名額
  assert.equal(g.expand().ok, false); // 3 級才可擴建
  g.s.level = 3;
  assert.equal(g.expand().ok, true);
  assert.equal(g.grid.w, 10);
});

test('任務依序推進', () => {
  const g = mk(7);
  let cur = g.currentQuest();
  assert.equal(cur.q.id, 'q1');
  assert.equal(g.claimQuest().ok, false);
  for (let i = 0; i < 40 && !g.currentQuest().done; i++) {
    run(g, 5);
    const k = Object.keys(g.s.drops)[0];
    if (k) g.collect(...k.split(',').map(Number));
  }
  assert.equal(g.currentQuest().done, true);
  assert.equal(g.claimQuest().ok, true);
  assert.equal(g.currentQuest().q.id, 'q2');
});

test('存檔往返與壞資料修復', () => {
  const g = mk(7);
  run(g, 30);
  const text = RC.state.serialize(g.s);
  const back = RC.state.parse(text);
  assert.deepEqual(back.items, g.s.items);
  assert.equal(back.coins, g.s.coins);
  assert.equal(back.staff.length, g.s.staff.length);
  const bad = RC.state.normalize({ coins: 'x', items: [{ id: 'nope', x: 1, y: 1 }, { id: 'table_wood', x: 99, y: 0 }, { id: 'table_wood', x: 2, y: 2 }, { id: 'table_wood', x: 2, y: 2 }], level: 9999 });
  assert.equal(bad.items.length, 1);
  assert.equal(bad.level, D.MAX_LEVEL);
  assert.ok(Number.isFinite(bad.coins));
  assert.equal(RC.state.load({ getItem: () => '{oops' }), null);
});

test('經濟平衡：自動玩 20 分鐘（有收款、會買東西）能順利成長', () => {
  const g = mk(11);
  let t = 0;
  const log = [];
  while (t < 1200) {
    g.update(0.1);
    t += 0.1;
    if (Math.floor(t * 10) % 20 === 0) {
      for (const k of Object.keys(g.s.drops)) g.collect(...k.split(',').map(Number));
      // 簡單 AI：優先把錢花在座位 → 人手 → 爐灶
      const s = g.s;
      const cur = g.currentQuest();
      if (cur && cur.done) g.claimQuest();
      const free = (() => { for (let y = 0; y < g.grid.h; y++) for (let x = 0; x < g.grid.w; x++) if (!g.grid.occ[y * g.grid.w + x] && !(y === D.DOOR_Y && x <= 1)) return { x, y }; return null; })();
      if (s.coins >= 200 && s.staff.length < D.maxStaffForLevel(s.level) && s.candidates[0]) g.hire(0);
      else if (g.stoves.length < Math.ceil(s.staff.length * 0.8) && s.coins >= 150 && free) { g.buyFurniture('stove_gas'); const f = RC.world; for (let y = 0; y < g.grid.h; y++) { for (let x = 0; x < g.grid.w; x++) { if (g.placeFromInventory('stove_gas', x, y, 0).ok) { y = 99; break; } } } }
      else if (g.stoves.length >= Math.ceil(s.staff.length * 0.8) && g.seats.length < s.staff.length * 4 + 2 && s.coins >= 105) {
        // 一桌兩椅，找空位：桌在 (x,y)，椅在左右
        outer: for (let y = 1; y < g.grid.h - 1; y++) for (let x = 2; x < g.grid.w - 2; x++) {
          const ok = (a, b) => RC.world.canPlace(g.grid, D.furniture.table_wood, a, b, 0).ok;
          if (ok(x, y) && ok(x - 1, y) && ok(x + 1, y)) {
            g.buyFurniture('table_wood'); g.buyFurniture('chair_stool'); g.buyFurniture('chair_stool');
            g.placeFromInventory('table_wood', x, y, 0); g.placeFromInventory('chair_stool', x - 1, y, 0); g.placeFromInventory('chair_stool', x + 1, y, 2);
            break outer;
          }
        }
      }
      if (s.level >= 2 && !s.dishes.fantuan && s.coins >= 150) g.learnDish('fantuan');
      if (s.level >= 3 && !s.dishes.luroufan && s.coins >= 400) g.learnDish('luroufan');
    }
    if (Math.floor(t) % 300 === 0 && Math.abs(t - Math.round(t)) < 0.05) log.push([Math.round(t), g.s.level, g.s.coins, g.s.stats.served, g.s.staff.length, g.seats.length, g.stoves.length, g.s.stats.angry, g.customers.length]);
  }
  console.log('  [t, lv, coins, served, staff, seats, stoves, angry, cust]', JSON.stringify(log));
  assert.ok(g.s.stats.served >= 100, '20 分鐘至少服務 100 位，實際 ' + g.s.stats.served);
  assert.ok(g.s.level >= 4, '20 分鐘應至少 4 級，實際 ' + g.s.level);
});
