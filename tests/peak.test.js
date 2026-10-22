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

/** 開好店、雇好人，回傳遊戲；levels 是各員工（掌櫃之外）的等級 */
function staffed(levels, open = 8, close = 22, seed = 7) {
  const g = mk(seed, {}, (s) => ((s.coins = 1e7), (s.level = 40)));
  levels.forEach((lv, i) => {
    assert.equal(g.hire(i % 3).ok, true);
    g.s.staff[g.s.staff.length - 1].level = lv;
  });
  g.setBusinessHours(open, close);
  g.setAutoSchedule(true);
  return g;
}
const peakShare = (g, rec) => {
  let peak = 0;
  let n = 0;
  for (let j = 0; j < D.DAY.shiftHours; j++) {
    const h = (rec.shift + j) % 24;
    if (h < g.s.schedule.open || h >= g.s.schedule.close) continue;
    n++;
    if (D.demandKind(D.DEMAND[h]) === 'peak') peak++;
  }
  return n ? peak / n : 0;
};

test('自動排班：資深員工（等級高）補尖峰，午餐與晚餐尖峰人手都夠', () => {
  const g = staffed([8, 8, 8, 8]);
  const cov = g.coverage();
  const lunch = [12, 13].map((h) => cov.staff[h]);
  const dinner = [18, 19].map((h) => cov.staff[h]);
  assert.ok(Math.min(...lunch) >= 3 && Math.min(...dinner) >= 3, `午餐 ${lunch}、晚餐 ${dinner}`);
  for (let h = 8; h < 22; h++) assert.ok(cov.staff[h] >= 1, `${h}:00 有人在班`);
});

test('自動排班：資淺員工（等級低）分成 2～3 個時段上班，不是全部擠在同一個鐘點', () => {
  const g = staffed([1, 1, 2, 2, 3, 3]);
  const starts = new Set(g.s.staff.filter((m) => !m.boss).map((m) => m.shift));
  assert.ok(starts.size >= 2 && starts.size <= 4, `起點：${[...starts].sort((a, b) => a - b)}`); // 3 個時段 + 掌櫃之外的收店班最多再多一個
  const juniors = g.s.staff.filter((m) => !m.boss && m.level < D.DAY.seniorLevel);
  const jStarts = new Set(juniors.slice(2).map((m) => m.shift)); // 前面的人先蓋滿營業時間，後面才是分時段的
  assert.ok(jStarts.size >= 2, `分時段的資淺員工起點：${[...jStarts]}`);
  assert.ok(jStarts.size <= 3);
  for (const m of g.s.staff) assert.ok(m.shift >= 8 && m.shift <= 14, `${m.name} 在 ${m.shift} 點上班（要在可排的區間內）`);
});

test('自動排班：資深員工比資淺員工更集中在尖峰', () => {
  const g = staffed([9, 9, 9, 1, 1, 1]);
  const extras = g.s.staff.filter((m) => !m.boss).slice(2); // 前兩位先蓋滿營業時間
  const seniors = extras.filter((m) => m.level >= D.DAY.seniorLevel);
  const juniors = extras.filter((m) => m.level < D.DAY.seniorLevel);
  assert.ok(seniors.length && juniors.length);
  const avg = (xs) => xs.reduce((a, b) => a + peakShare(g, b), 0) / xs.length;
  assert.ok(avg(seniors) >= avg(juniors), `資深 ${avg(seniors).toFixed(2)}、資淺 ${avg(juniors).toFixed(2)}`);
});

test('自動排班：掌櫃排開店班、值班店長排收店班，營業時間內隨時有人能結帳', () => {
  const g = staffed([10, 6, 3, 2]);
  const mgr = g.s.staff.find((m) => !m.boss && m.level >= D.DAY.managerLevel);
  assert.equal(g.assignManager(mgr.id).ok, true);
  const cov = g.coverage();
  assert.equal(g.s.staff[0].shift, 8, '掌櫃開店');
  assert.equal(mgr.shift, 14, '值班店長收店（14:00–22:00）');
  for (let h = 8; h < 22; h++) assert.ok(cov.payers[h] >= 1, `${h}:00 有掌櫃或店長在班`);
});

test('自動排班：營業時間不到 8 小時時只有一個可排的起點，大家都從開店起', () => {
  const g = staffed([8, 1, 1], 9, 17);
  assert.ok(g.s.staff.every((m) => m.shift === 9));
});

test('自動排班：結果固定（同樣的人手與營業時間排出同一份班表）', () => {
  const a = staffed([8, 6, 3, 1, 1]);
  const b = staffed([8, 6, 3, 1, 1]);
  assert.deepEqual(a.s.staff.map((m) => m.shift), b.s.staff.map((m) => m.shift));
  const before = a.s.staff.map((m) => m.shift);
  a.autoSchedule();
  assert.deepEqual(a.s.staff.map((m) => m.shift), before);
});
