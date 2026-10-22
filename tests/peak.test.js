'use strict';
// 客流的尖峰與離峰：午、晚餐尖峰客人多，下午與深夜客人少；尖峰時客人較有耐心、客滿走掉的扣分減半
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;

const mk = (seed = 1, opts = {}, mut) => {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  if (mut) mut(s);
  return new RC.Game(s, { seed, ...opts });
};

test('客流曲線：24 個整點、午晚餐是尖峰、下午與深夜是離峰、兩點之間線性過渡', () => {
  assert.equal(D.DEMAND.length, 24);
  assert.ok(D.DEMAND.every((v) => v > 0 && v <= 2));
  assert.equal(D.demandKind(D.demandAt(12.5)), 'peak');
  assert.equal(D.demandKind(D.demandAt(18.5)), 'peak');
  assert.equal(D.demandKind(D.demandAt(15.5)), 'off');
  assert.equal(D.demandKind(D.demandAt(3)), 'off');
  assert.equal(D.demandKind(D.demandAt(11)), 'normal');
  assert.equal(D.demandAt(12), D.DEMAND[12]);
  assert.ok(Math.abs(D.demandAt(12.5) - (D.DEMAND[12] + D.DEMAND[13]) / 2) < 1e-9);
  assert.ok(Math.abs(D.demandAt(24) - D.demandAt(0)) < 1e-9, '24 點等於 0 點');
  assert.ok(D.demandAt(23.5) > 0, '跨午夜的插值正常');
});

test('尖峰時客人明顯比離峰多（同一間店、同一批員工連續量測多天）', () => {
  const g = mk(3, {}, (s) => ((s.coins = 1e5), (s.level = 8)));
  g.hire(0);
  g.setBusinessHours(8, 22);
  const hours = Array(24).fill(0);
  const startDay = g.s.day;
  let guard = 0;
  while (g.s.day < startDay + 6 && guard++ < 3e6) {
    const h = Math.floor(g.hour);
    const before = g.nextPid;
    g.update(0.1);
    hours[h] += g.nextPid - before;
  }
  const lunch = hours[12] + hours[13];
  const afternoon = hours[15] + hours[16];
  const dinner = hours[18] + hours[19];
  assert.ok(lunch > afternoon * 2, `午餐尖峰 ${lunch} 組，下午離峰 ${afternoon} 組`);
  assert.ok(dinner > afternoon * 2, `晚餐尖峰 ${dinner} 組，下午離峰 ${afternoon} 組`);
  assert.equal(hours[3], 0, '沒營業的時間沒有客人');
});

test('不分日夜的測試模式：客流倍率固定為 1', () => {
  const g = mk(1, { dayMode: false });
  assert.equal(g.demand(), 1);
  assert.equal(g.isPeak(), false);
});

test('尖峰時候位的耐心延長、客滿走掉的風評扣分減半；離峰照常', () => {
  const setup = (clock) => {
    const g = mk(5);
    g.s.clock = clock;
    g.queue.push({ id: 900, size: 1, looks: [RC.state.makeLook(g.rng)], p: 1, tableUid: null, dined: 0 });
    return g;
  };
  // 同樣的 dt 下，尖峰消耗的耐心比離峰少（桌子都被占用，候位只會消耗耐心）
  const a = setup(15.5 * 60);
  const b = setup(12.5 * 60);
  for (const g of [a, b]) for (const t of g.tables.values()) g.tableParty.set(t.uid, -1);
  a.stepQueue(1);
  b.stepQueue(1);
  assert.ok(b.queue[0].p > a.queue[0].p, `尖峰耐心剩 ${b.queue[0].p.toFixed(4)}，離峰 ${a.queue[0].p.toFixed(4)}`);
  assert.ok(Math.abs((1 - b.queue[0].p) * D.PEAK_PATIENCE - (1 - a.queue[0].p)) < 1e-9);
  // 風評：耐心耗盡走掉時，尖峰只扣一半
  for (const [g, share] of [[a, 1], [b, D.PEAK_REP_SHARE]]) {
    g.s.reputation = 0;
    g.queue[0].p = 0.0001;
    g.stepQueue(1);
    assert.equal(g.queue.length, 0);
    assert.ok(Math.abs(g.s.reputation - D.REPUTATION.walkout * share) < 1e-9, `風評 ${g.s.reputation}`);
  }
});

test('自動排班：多出來的人排在尖峰（人手最吃緊的時段），而不是全部擠在開店', () => {
  const g = mk(7, {}, (s) => ((s.coins = 1e6), (s.level = 20)));
  for (let i = 0; i < 3; i++) assert.equal(g.hire(i % 3).ok, true);
  g.setBusinessHours(8, 22); // 14 小時：需要 2 個班蓋滿，多出來的 2 人要補尖峰
  g.setAutoSchedule(true);
  const cov = g.coverage();
  const lunch = [12, 13].map((h) => cov.staff[h]);
  const dinner = [18, 19].map((h) => cov.staff[h]);
  assert.ok(Math.min(...lunch) >= 2 && Math.min(...dinner) >= 2, `午晚餐尖峰人手：${lunch} / ${dinner}`);
  assert.ok(new Set(g.s.staff.map((m) => m.shift)).size >= 3, '班表錯開，不是全部擠在同一個鐘點上班');
  for (let h = 8; h < 22; h++) assert.ok(cov.staff[h] >= 1, `${h}:00 有人在班`);
  assert.ok(g.s.staff.every((m) => m.shift >= 0 && m.shift <= 23));
});
