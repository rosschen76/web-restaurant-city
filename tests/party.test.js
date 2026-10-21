'use strict';
// 群體客人：不併桌、門外候位、同組一起離席、桌面餐具、離線收益。
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;

/** 以指定物件建立遊戲（不含預設擺設）。items: [id,x,y,rot] */
function mk(items, seed = 1) {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  s.items = [];
  s.nextUid = 1;
  for (const [id, x, y, rot] of items) s.items.push({ uid: s.nextUid++, id, x, y, rot: rot || 0 });
  return new RC.Game(s, { seed, dayMode: false });
}
const run = (g, sec, dt = 0.1) => {
  for (let t = 0; t < sec; t += dt) g.update(dt);
};
function party(g, size, extra) {
  return { id: g.nextPid++, size, looks: Array.from({ length: size }, () => RC.state.makeLook(g.rng)), vip: false, vipTitle: null, p: 1, tableUid: null, dined: 0, ...extra };
}
const STOVE = ['stove_gas', 5, 0];
// 桌 A：2 張椅；桌 B：4 張椅
const TWO_TABLES = [
  STOVE,
  ['table_wood', 5, 3], ['chair_stool', 4, 3], ['chair_stool', 6, 3, 2],
  ['table_wood', 2, 6], ['chair_stool', 1, 6], ['chair_stool', 3, 6, 2], ['chair_stool', 2, 5, 1], ['chair_stool', 2, 7, 3],
];

test('桌子容量：以桌為單位統計座位', () => {
  const g = mk(TWO_TABLES);
  assert.equal(g.tables.size, 2);
  assert.deepEqual([...g.tables.values()].map((t) => t.seats.length).sort(), [2, 4]);
  assert.equal(g.maxTableCap, 4);
});

test('不強制併桌：不同組不會共用同一張桌子，且採最小夠坐', () => {
  const g = mk(TWO_TABLES);
  const trio = party(g, 3);
  g.queue.push(trio);
  g.seatQueue();
  assert.equal(g.queue.length, 0);
  assert.equal(g.tables.get(trio.tableUid).seats.length, 4, '3 人只能坐 4 人桌');
  const solo = party(g, 1);
  g.queue.push(solo);
  g.seatQueue();
  assert.equal(g.tables.get(solo.tableUid).seats.length, 2, '1 人應挑小桌（最小夠坐）');
  const solo2 = party(g, 1);
  g.queue.push(solo2);
  g.seatQueue();
  assert.deepEqual(g.queue, [solo2], '兩桌都有人，第三組要在門外等，不能去併桌（4 人桌還空 1 位）');
  // 每個椅子只坐一個人
  const seats = g.customers.map((c) => c.seat);
  assert.equal(new Set(seats).size, seats.length);
});

test('組內成員依序進場、坐在同一張桌子', () => {
  const g = mk(TWO_TABLES);
  const quad = party(g, 4);
  g.queue.push(quad);
  g.seatQueue();
  const members = g.customers.filter((c) => c.party === quad.id);
  assert.equal(members.length, 4);
  assert.equal(new Set(members.map((m) => g.seatByChair.get(m.seat).tableUid)).size, 1);
  run(g, 1);
  assert.ok(members.some((m) => m.state === 'arrive') && members.some((m) => m.state !== 'arrive'), '進場有先後');
});

test('不會出現比最大桌子還大的團體', () => {
  const g = mk([STOVE, ['table_wood', 3, 3], ['chair_stool', 2, 3], ['chair_stool', 4, 3, 2]]);
  assert.equal(g.maxTableCap, 2);
  for (let i = 0; i < 300; i++) {
    g.queue = [];
    g.trySpawn();
    assert.ok(g.lastPartySize <= 2, '人數 ' + g.lastPartySize);
  }
});

test('候位上限 6 人：超過的直接離開並記錄', () => {
  const g = mk(TWO_TABLES);
  g.tableParty.set([...g.tables.keys()][0], 901); // 兩桌都被佔住
  g.tableParty.set([...g.tables.keys()][1], 902);
  let max = 0;
  for (let i = 0; i < 200; i++) {
    g.trySpawn();
    max = Math.max(max, g.queuePeople());
  }
  assert.ok(max <= D.QUEUE_MAX_PEOPLE && max >= 4, '最大候位人數 ' + max);
  assert.ok(g.s.stats.walkouts > 0);
});

test('候位耐心耗盡就離開（不算差評）', () => {
  const g = mk(TWO_TABLES);
  g.spawnTimer = 1e9; // 只觀察這一組
  for (const uid of g.tables.keys()) g.tableParty.set(uid, 999);
  g.queue.push(party(g, 2));
  const angry0 = g.s.stats.angry;
  run(g, D.QUEUE_PATIENCE + 5);
  assert.equal(g.queue.length, 0);
  assert.ok(g.s.stats.walkouts >= 1);
  assert.equal(g.s.stats.angry, angry0);
});

test('桌子變小（移走椅子）後，坐不下的候位組直接離開', () => {
  const g = mk(TWO_TABLES);
  for (const uid of g.tables.keys()) g.tableParty.set(uid, 999);
  g.queue.push(party(g, 4));
  for (const it of g.s.items.filter((i) => i.id === 'chair_stool' && i.y >= 6)) g.storeItem(it.uid);
  g.update(0.1);
  assert.equal(g.queue.length, 0);
});

test('每位客人各自結帳離開；整組都走了桌子才釋出，並留下餐具', () => {
  const g = mk(TWO_TABLES, 4);
  let sawDirty = false;
  let sawPartiallyLeft = false;
  for (let t = 0; t < 900; t += 0.1) {
    g.update(0.1);
    for (const p of g.parties) {
      const members = g.customers.filter((c) => c.party === p.id);
      const leaving = members.filter((c) => c.state === 'leave').length;
      // 桌子在整組離席前一直被這組占用
      if (leaving < members.length) assert.equal(g.tableParty.get(p.tableUid), p.id, '還有人沒走，桌子不能釋出');
      // 同組有人已經結帳離開、其他人還在：代表各自結帳，而不是一起離席
      if (p.size > 1 && leaving > 0 && leaving < members.length) sawPartiallyLeft = true;
    }
    for (const uid of g.dirty.keys()) {
      sawDirty = true;
      assert.ok(!g.tableParty.has(uid), '桌子髒了就已經不屬於任何一組');
    }
  }
  assert.ok(g.s.stats.served > 10, '服務人數 ' + g.s.stats.served);
  assert.ok(sawDirty, '應該出現過待收拾的桌子');
  assert.ok(sawPartiallyLeft, '多人組應該出現過有人先結帳離開、同伴還在座位上');
});

test('有人等太久：整組一起氣走，只記一次差評，已付錢的同伴照常開心離席', () => {
  const g = mk(TWO_TABLES, 2);
  g.spawnTimer = 1e9;
  const trio = party(g, 3);
  g.queue.push(trio);
  g.seatQueue();
  g.crew.forEach((m) => { m.rec.boss = false; m.boss = false; }); // 沒人幫忙，客人一定會氣走
  g.crew.forEach((m) => { m.state = 'rest'; m.rec.energy = 0; });
  for (let t = 0; t < 80; t += 0.1) {
    g.crew.forEach((m) => { m.state = 'rest'; m.rec.energy = 0; });
    g.update(0.1);
  }
  assert.equal(g.s.stats.angry, 1);
  assert.equal(g.customers.filter((c) => c.party === trio.id).length, 0, '全組都走了');
});

test('客人離席後桌上留下餐具，要收拾完才能給下一組', () => {
  const g = mk([STOVE, ['table_wood', 3, 3], ['chair_stool', 2, 3], ['chair_stool', 4, 3, 2]], 3);
  const tableUid = [...g.tables.keys()][0];
  let sawDirty = false;
  let blocked = false;
  for (let t = 0; t < 400; t += 0.1) {
    g.update(0.1);
    if (g.dirty.has(tableUid)) {
      sawDirty = true;
      assert.equal(g.findTable(1), null, '桌面還沒收就不能入座');
      blocked = true;
    }
  }
  assert.ok(sawDirty && blocked);
  assert.ok(g.s.stats.served >= 3, '桌子有被收拾、持續營運：' + g.s.stats.served);
});

test('沒吃到東西就離開的組別不會留下餐具', () => {
  const g = mk(TWO_TABLES, 5);
  const p = party(g, 2);
  g.queue.push(p);
  g.seatQueue();
  g.sendParty(p.id, false);
  run(g, 15);
  assert.equal(g.dirty.size, 0);
});

test('離線收益：真實模擬快轉、依效率折算', () => {
  const g = new RC.Game(RC.state.newGame(RC.util.makeRng(9)), { seed: 9, dayMode: false });
  let levelEvents = 0;
  g.on('levelup', () => levelEvents++);
  assert.equal(g.catchUp(2), null, '太短不處理');
  assert.equal(g.catchUp(NaN), null);
  assert.equal(g.catchUp(-50), null);
  const r = g.catchUp(3600);
  assert.equal(r.simulated, 3600 * D.OFFLINE.efficiency);
  assert.equal(r.show, true);
  assert.equal(r.capped, false);
  assert.ok(r.served > 20, '離線期間應服務不少客人：' + r.served);
  assert.ok(r.earned > 0);
  assert.equal(levelEvents, 0, '快轉期間不發事件');
  assert.equal(g.quiet, false);
  assert.ok(r.levelTo >= r.levelFrom);
  const r2 = g.catchUp(30);
  assert.equal(r2.show, false, '30 秒不打擾玩家');
});

test('離線收益上限：超過 8 小時只算 8 小時，且速度夠快', () => {
  const g = new RC.Game(RC.state.newGame(RC.util.makeRng(3)), { seed: 3, dayMode: false });
  const t0 = Date.now();
  const r = g.catchUp(100 * 3600);
  const ms = Date.now() - t0;
  assert.equal(r.capped, true);
  assert.equal(r.simulated, D.OFFLINE.maxHours * 3600 * D.OFFLINE.efficiency);
  assert.ok(ms < 15000, '快轉花了 ' + ms + 'ms');
  console.log('  離線快轉（8 小時封頂）耗時 ' + ms + 'ms，服務 ' + r.served + ' 位，升到 Lv.' + r.levelTo);
});
