'use strict';
// 店掌櫃：玩家本人，不可開除、可改名；桌上的金幣只有他能收。
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');

const mk = (seed = 1) => new RC.Game(RC.state.newGame(RC.util.makeRng(seed)), { seed, dayMode: false });
const run = (g, sec, dt = 0.1) => {
  for (let t = 0; t < sec; t += dt) g.update(dt);
};

test('開局就有店掌櫃，且只有一位', () => {
  const g = mk();
  assert.equal(g.s.staff.filter((m) => m.boss).length, 1);
  assert.equal(g.s.staff[0].boss, true);
  assert.equal(g.crew[0].boss, true);
});

test('店掌櫃不能開除、可以改名；其他員工可以開除', () => {
  const g = mk();
  g.s.coins = 1e5;
  g.s.level = 3;
  const bossId = g.s.staff[0].id;
  assert.equal(g.fire(bossId).ok, false);
  assert.equal(g.s.staff.length, 1);
  assert.equal(g.renameBoss('  老闆娘  ').ok, true);
  assert.equal(g.s.staff[0].name, '老闆娘');
  assert.equal(g.renameBoss('一二三四五六七八九十').ok, true);
  assert.equal(g.s.staff[0].name, '一二三四五六七八');
  assert.equal(g.renameBoss('   ').ok, false);
  assert.equal(g.hire(0).ok, true);
  const hired = g.s.staff.find((m) => !m.boss);
  assert.equal(g.fire(hired.id).ok, true);
  assert.equal(g.s.staff.length, 1);
});

test('掌櫃不佔員工名額；他不會累', () => {
  const g = mk();
  g.s.coins = 1e5;
  g.s.level = 1;
  assert.equal(g.hire(0).ok, true, '1 級也能雇 1 位（掌櫃不算）');
  assert.equal(g.hire(0).ok, false);
  const boss = g.crew.find((m) => m.boss);
  boss.rec.energy = 3;
  g.update(0.1);
  assert.equal(boss.rec.energy, 100);
});

test('舊存檔（沒有 boss 欄位）會自動指定第一位員工為掌櫃', () => {
  const s = RC.state.newGame(RC.util.makeRng(1));
  const raw = JSON.parse(JSON.stringify(s));
  raw.staff.forEach((m) => delete m.boss);
  raw.staff.push({ ...raw.staff[0], id: 99, name: '路人' });
  const back = RC.state.normalize(raw);
  assert.deepEqual(back.staff.map((m) => m.boss), [true, false]);
  const two = JSON.parse(JSON.stringify(s));
  two.staff.push({ ...two.staff[0], id: 7, name: '二號', boss: true });
  assert.equal(RC.state.normalize(two).staff.filter((m) => m.boss).length, 1, '最多一位掌櫃');
});

const D = RC.data;

/** 讓一位客人直接進入「吃完、等結帳」狀態（不經過整套烹飪流程）。 */
function payer(g, seatIndex = 0, extra = {}) {
  const party = { id: g.nextPid++, size: 1, looks: [RC.state.makeLook(g.rng)], vip: false, vipTitle: null, p: 1, tableUid: null, dined: 1 };
  g.queue.push(party);
  g.seatQueue();
  const c = g.customers.find((x) => x.party === party.id);
  const seat = g.seatByChair.get(c.seat);
  Object.assign(c, { state: 'wait_pay', x: seat.x + 0.5, y: seat.y + 0.5, face: seat.face, dish: 'danbing', servedP: 1, bill: 20, tipBase: 10, payWait: 0, fade: 1, path: [] }, extra);
  return c;
}
const stopSpawns = (g) => { g.spawnTimer = 1e9; };

test('吃完的客人坐著等結帳，座位一直被占用，掌櫃結完帳才釋放、客人才離開', () => {
  const g = mk(7);
  let verified = 0;
  for (let t = 0; t < 600; t += 0.1) {
    g.update(0.1);
    for (const c of g.customers) {
      if (c.state === 'wait_pay') assert.equal(g.seatTaken.get(c.seat), c.id, '結帳前座位仍被占用');
      if (c.state === 'leave' && c.t === 0 && !c.angry) {
        assert.ok(c.paid > 0, '離開的客人一定已經付過錢');
        assert.ok(!g.seatTaken.has(c.seat), '離開的同時座位被釋放');
        verified++;
      }
    }
  }
  assert.ok(verified >= 5, '驗證了 ' + verified + ' 位');
});

test('只有掌櫃能結帳：員工從不收款，而且客人付款前不會離開', () => {
  const g = mk(7);
  g.s.coins = 1e5;
  g.s.level = 3;
  g.hire(0);
  g.hire(1);
  const boss = g.crew.find((m) => m.boss);
  let bossPaid = 0;
  for (let t = 0; t < 600; t += 0.1) {
    const before = g.s.stats.collects;
    g.update(0.1);
    for (const m of g.crew) if (!m.boss) assert.ok(m.state !== 'to_pay' && m.state !== 'paying' && !m.pay, '員工不能收款');
    if (g.s.stats.collects > before && boss.state === 'idle') bossPaid += g.s.stats.collects - before;
  }
  assert.ok(g.s.stats.collects >= 10);
  assert.ok(bossPaid >= 5, '多數款項由掌櫃親自收：' + bossPaid + '/' + g.s.stats.collects);
});

test('掌櫃走到顧客旁才收款；收款前金幣不入帳', () => {
  const g = mk(5);
  stopSpawns(g);
  const c = payer(g);
  const boss = g.crew[0];
  const before = g.s.coins;
  g.update(0.1);
  assert.equal(boss.state, 'to_pay');
  assert.equal(c.payBy, boss.id);
  assert.equal(g.s.coins, before);
  let steps = 0;
  while (c.state === 'wait_pay' && steps++ < 300) g.update(0.1);
  assert.equal(c.state, 'leave');
  assert.equal(g.s.coins, before + c.paid);
  assert.ok(c.paid >= 20 && c.paid <= 30);
  assert.equal(g.s.stats.collects, 1);
});

test('掌櫃煮到一半不被打斷，空下來才去結帳', () => {
  const g = mk(5);
  stopSpawns(g);
  const boss = g.crew[0];
  boss.state = 'cooking'; // 煮菜、上菜、送餐中都不打斷
  const c = payer(g);
  g.dispatchBoss();
  assert.ok(!boss.pay, '煮菜中不接結帳');
  assert.equal(c.payBy, null);
  boss.state = 'idle';
  g.dispatchBoss();
  assert.equal(boss.state, 'to_pay');
  assert.equal(c.payBy, boss.id);
});

test('點客人請掌櫃優先：被點的先收，其餘依等待久的順序', () => {
  const g = mk(5);
  stopSpawns(g);
  const a = payer(g);
  const b = payer(g, 1, { payWait: 20 });
  assert.notEqual(a.seat, b.seat);
  g.dispatchBoss();
  assert.equal(g.crew[0].pay.cid, b.id, '等最久的先收');
  g.crew[0].pay = null; b.payBy = null; g.crew[0].state = 'idle';
  assert.equal(g.rushPay(a.id).ok, true);
  g.dispatchBoss();
  assert.equal(g.crew[0].pay.cid, a.id, '被點過的優先');
  assert.equal(g.rushPay(99999).ok, false);
});

/** 多張單人小桌，讓好幾位單人客同時入座 */
function mkManyTables(seed = 5) {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  s.items = [];
  s.nextUid = 1;
  const add = (id, x, y, rot = 0) => s.items.push({ uid: s.nextUid++, id, x, y, rot });
  add('stove_gas', 5, 0);
  for (let i = 0; i < 4; i++) {
    add('table_wood', 3, 2 + i);
    add('chair_stool', 2, 2 + i);
  }
  return new RC.Game(s, { seed, dayMode: false });
}

test('小費隨等待時間遞減，等滿 30 秒沒有小費', () => {
  const g = mkManyTables();
  stopSpawns(g);
  const fast = payer(g, 0, { payWait: 0 });
  const slow = payer(g, 1, { payWait: 30 });
  const mid = payer(g, 2, { payWait: 15 });
  const coins = g.s.coins;
  g.settle(fast, {});
  g.settle(mid, {});
  g.settle(slow, {});
  assert.equal(fast.paid, 30);
  assert.equal(mid.paid, 25);
  assert.equal(slow.paid, 20);
  assert.equal(g.s.coins, coins + 75);
});

test('沒人來收也不會卡死：等 45 秒自助結帳（沒有小費）', () => {
  const g = mk(5);
  stopSpawns(g);
  g.crew[0].state = 'cooking'; // 掌櫃一直忙，也沒有其他員工
  const c = payer(g);
  for (let i = 0; i < 480 && c.state === 'wait_pay'; i++) {
    g.crew[0].state = 'cooking';
    g.crew[0].t = 99;
    g.update(0.1);
  }
  assert.equal(c.state, 'leave');
  assert.equal(c.paid, 20, '自助結帳沒有小費');
  assert.ok(c.payWait >= 44);
});

test('版面變動讓座位消失：等結帳的客人直接結清離開，錢不會憑空消失', () => {
  const g = mk(5);
  stopSpawns(g);
  const c = payer(g);
  const coins = g.s.coins;
  g.storeItem(c.seat); // 椅子被收起來
  assert.equal(c.state, 'leave');
  assert.equal(g.s.coins, coins + 20, '結清（沒有小費）');
  assert.equal(g.seatTaken.has(c.seat), false);
});

test('同組有人等太久氣走時，已吃完等結帳的同伴仍然留下來付錢', () => {
  const g = mk(5);
  stopSpawns(g);
  const party = { id: g.nextPid++, size: 2, looks: [RC.state.makeLook(g.rng), RC.state.makeLook(g.rng)], vip: false, vipTitle: null, p: 1, tableUid: null, dined: 1 };
  g.queue.push(party);
  g.seatQueue();
  const [a, b] = g.customers.filter((x) => x.party === party.id);
  Object.assign(a, { state: 'wait_pay', bill: 20, tipBase: 0, payWait: 0, dish: 'danbing', servedP: 1, fade: 1 });
  Object.assign(b, { state: 'wait_order', p: 0.0001, dish: 'danbing', fade: 1 });
  g.crew[0].state = 'rest'; g.crew[0].rec.energy = 0; // 讓 b 一定氣走
  g.crew[0].boss = false;
  g.update(0.5);
  assert.equal(b.state, 'leave');
  assert.equal(b.angry, true);
  assert.equal(a.state, 'wait_pay', '吃完的同伴留下來結帳');
  assert.equal(g.s.stats.angry, 1);
});

test('裝潢暫停：paused 時時間完全不流動，離線補算也不會發生', () => {
  const g = mk(7);
  run(g, 30);
  g.paused = true;
  const snap = JSON.stringify([g.s.stats, g.customers.map((c) => [c.x, c.y, c.state, c.p]), g.crew.map((m) => [m.x, m.y, m.state, m.t])]);
  const q = g.spawnTimer;
  run(g, 120);
  assert.equal(JSON.stringify([g.s.stats, g.customers.map((c) => [c.x, c.y, c.state, c.p]), g.crew.map((m) => [m.x, m.y, m.state, m.t])]), snap, '暫停期間任何東西都不動');
  assert.equal(g.spawnTimer, q);
  assert.equal(g.catchUp(7200), null, '暫停中不做離線補算');
  g.paused = false;
  run(g, 30);
  assert.notEqual(JSON.stringify(g.s.stats), JSON.stringify(JSON.parse(snap)[0]), '恢復後時間繼續');
});

test('暫停中仍可改版面，恢復後營運正常', () => {
  const g = mk(7);
  run(g, 20);
  g.paused = true;
  g.buyFurniture('chair_wood');
  assert.equal(g.placeFromInventory('chair_wood', 3, 5, 0).ok, true);
  const t = g.customers.find((c) => c.state !== 'leave');
  if (t) g.storeItem(t.seat);
  g.paused = false;
  run(g, 60);
  assert.ok(g.s.stats.served >= 2);
});

test('舊存檔桌上未收的金幣，載入時併入金幣', () => {
  const s = RC.state.newGame(RC.util.makeRng(1));
  const raw = JSON.parse(JSON.stringify(s));
  raw.coins = 100;
  raw.drops = { '3,4': 50, '3,6': 25 };
  const back = RC.state.normalize(raw);
  assert.equal(back.coins, 175);
  assert.equal(back.drops, undefined);
});
