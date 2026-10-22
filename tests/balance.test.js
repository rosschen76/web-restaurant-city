'use strict';
// 平衡性：客流對齊人手上限、入座控管、員工名額與日薪表、擴建階段、環境加成
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;

const mk = (seed = 1, opts = {}, mut) => {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  if (mut) mut(s);
  return new RC.Game(s, { seed, ...opts });
};

test('員工名額：到 Lv18 為 8 位（和原本一樣），之後 Lv21/24/27/30 各 +1，最多 12 位', () => {
  const expect = { 1: 1, 2: 2, 4: 3, 6: 4, 9: 5, 12: 6, 15: 7, 18: 8, 20: 8, 21: 9, 24: 10, 27: 11, 30: 12, 50: 12 };
  for (const [lv, n] of Object.entries(expect)) assert.equal(D.maxStaffForLevel(+lv), n, 'Lv' + lv);
  let prev = 0;
  for (let lv = 1; lv <= D.MAX_LEVEL; lv++) {
    const n = D.maxStaffForLevel(lv);
    assert.ok(n >= prev && n <= 12);
    prev = n;
  }
});

test('日薪表涵蓋所有名額；越後面的員工日薪越高', () => {
  const need = D.maxStaffForLevel(D.MAX_LEVEL) + 1;
  assert.ok(D.WAGE_BASE.length >= need, `日薪表只有 ${D.WAGE_BASE.length} 級`);
  for (let i = 2; i < D.WAGE_BASE.length; i++) assert.ok(D.WAGE_BASE[i] > D.WAGE_BASE[i - 1]);
});

test('擴建階段：邊長遞增、等級與費用遞增、最後一階 18×18', () => {
  const E = D.expansions;
  assert.equal(E.length, 6);
  for (let i = 1; i < E.length; i++) {
    assert.ok(E[i].w > E[i - 1].w && E[i].h > E[i - 1].h);
    assert.ok(E[i].cost > E[i - 1].cost && E[i].level > E[i - 1].level);
  }
  assert.deepEqual([E[5].w, E[5].h], [18, 18]);
  // 新階段可以真的擴建、存檔來回
  const g = mk(1, {}, (s) => ((s.coins = 1e7), (s.level = 40), (s.room.stage = 3)));
  g.rebuild();
  assert.equal(g.expand().ok, true);
  assert.equal(g.grid.w, 16);
  assert.equal(g.expand().ok, true);
  assert.equal(g.grid.w, 18);
  assert.equal(g.expand().ok, false, '已經是最大');
  const back = RC.state.parse(RC.state.serialize(g.s));
  assert.equal(back.room.stage, 5);
});

test('客人上門的間隔：對齊該等級的人手上限，魅力越高越頻繁；中後期不再是人手的好幾倍', () => {
  const gap = (lv, appeal) => {
    const g = mk(2, { dayMode: false }, (s) => (s.level = lv));
    g.appeal = appeal;
    const xs = [];
    for (let i = 0; i < 400; i++) xs.push(g.spawnInterval());
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };
  // 魅力越高，間隔越短
  assert.ok(gap(10, 300) < gap(10, 0));
  // 人手上限越多，間隔越短（同魅力）
  assert.ok(gap(18, 100) < gap(6, 100));
  // 處理量對得上：人力需求 = 每位客人的人力秒數 / 間隔，應該落在「在班人數」附近，而不是兩三倍以上
  for (const lv of [1, 6, 12, 18, 30]) {
    const labor = Math.min(D.FLOW.laborMax, D.FLOW.laborBase + D.FLOW.laborPerLevel * (lv - 1));
    const need = labor / gap(lv, 200);
    const people = D.maxStaffForLevel(lv) + 1;
    assert.ok(need <= people * 1.4, `Lv${lv}：需要 ${need.toFixed(1)} 人的人力，人手上限只有 ${people} 人`);
    assert.ok(need >= people * 0.5, `Lv${lv}：客人太少，只需要 ${need.toFixed(1)} 人`);
  }
});

test('入座控管：還沒開始用餐的客人超過在班員工的照顧能力時，新來的組留在門外候位', () => {
  const g = mk(3, { dayMode: false }, (s) => {
    s.level = 10;
    s.coins = 1e6;
  });
  // 擺很多座位，讓座位不是限制
  for (let i = 0; i < 5; i++) for (const id of ['table_wood', 'chair_stool', 'chair_stool']) g.buyFurniture(id);
  const W = RC.world;
  let placed = 0;
  for (let y = 2; y < g.grid.h && placed < 5; y += 2) {
    if (W.canPlace(g.grid, D.furniture.table_wood, 3, y, 0).ok && W.canPlace(g.grid, D.furniture.chair_stool, 2, y, 0).ok && W.canPlace(g.grid, D.furniture.chair_stool, 4, y, 0).ok) {
      g.placeFromInventory('table_wood', 3, y, 0);
      g.placeFromInventory('chair_stool', 2, y, 0);
      g.placeFromInventory('chair_stool', 4, y, 2);
      placed++;
    }
  }
  const limit = Math.max(D.FLOW.admitMin, Math.ceil(g.crew.length * D.FLOW.admitPerStaff));
  assert.ok(limit + 2 <= g.seats.length, `座位 ${g.seats.length} 要比出餐能力 ${limit} 多，才看得出控管`);
  const mkParty = () => ({ id: g.nextPid++, size: 1, looks: [RC.state.makeLook(g.rng)], p: 1, tableUid: null, dined: 0 });
  for (let i = 0; i < 12; i++) {
    g.queue.push(mkParty());
    g.seatQueue();
  }
  assert.equal(g.pendingGuests(), limit, '入座的客人數停在出餐能力上限');
  assert.ok(g.queue.length > 0, '多的組在門外候位');
  // 沒人在等的時候一律放行（不會卡死）
  const g2 = mk(4, { dayMode: false });
  assert.equal(g2.canAdmit(4), true);
});

test('入座控管不會讓餐廳停擺：長時間營運仍持續有客人入座、結帳', () => {
  const g = mk(5, { dayMode: false }, (s) => ((s.coins = 1e5), (s.level = 6)));
  g.hire(0);
  let t = 0;
  while (t < 600) {
    g.update(0.1);
    t += 0.1;
  }
  assert.ok(g.s.stats.served > 40, '10 分鐘服務 ' + g.s.stats.served);
  assert.ok(g.s.stats.angry <= g.s.stats.served * 0.3, `氣走 ${g.s.stats.angry} 位 / 服務 ${g.s.stats.served} 位`);
});

test('環境加成：魅力越高，客人越有耐心、小費越多', () => {
  const lo = mk(6, { dayMode: false });
  const hi = mk(6, { dayMode: false });
  lo.appeal = 0;
  hi.appeal = D.FLOW.appealFull;
  assert.equal(lo.ambience(), 0);
  assert.equal(hi.ambience(), 1);
  // 耐心：等點餐同樣經過 10 秒，高魅力的客人剩得比較多
  const wait = (g) => {
    const seat = g.seats[0];
    g.queue.push({ id: g.nextPid++, size: 1, looks: [RC.state.makeLook(g.rng)], p: 1, tableUid: null, dined: 0 });
    g.seatQueue();
    const c = g.customers[0];
    c.state = 'wait_order';
    c.p = 1;
    g.crew.length = 0; // 沒有人來點餐
    for (let i = 0; i < 100; i++) g.stepCustomer(c, 0.1);
    return c.p;
  };
  const pLo = wait(lo);
  const pHi = wait(hi);
  assert.ok(pHi > pLo, `低魅力剩 ${pLo.toFixed(3)}、高魅力剩 ${pHi.toFixed(3)}`);
  assert.ok(Math.abs((1 - pLo) / (1 - pHi) - (1 + D.FLOW.patienceBonus)) < 0.01);
  // 小費
  const tip = (g) => {
    const c = { dish: 'danbing', vip: false, servedP: 1, state: 'eat', seat: g.seats[0].uid, party: 1 };
    g.finishMeal(c);
    return c.tipBase;
  };
  assert.ok(tip(hi) > tip(lo));
  assert.equal(tip(hi), Math.round(tip(lo) * (1 + D.FLOW.tipBonus)));
});
