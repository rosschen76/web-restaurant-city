'use strict';
// 日薪制：雇用不再一次買斷，每天午夜發薪；領不到薪水會累積欠薪、連續 3 天就離職
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;

const mk = (seed = 1, mut) => {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  if (mut) mut(s);
  return new RC.Game(s, { seed });
};
/** 直接跑到下一個午夜（結算一天） */
const toMidnight = (g) => {
  const day = g.s.day;
  let guard = 0;
  while (g.s.day === day && guard++ < 1e6) g.update(0.1);
  assert.ok(guard < 1e6);
};

/** 午夜前一刻把金幣歸零，再結算（避免白天賺到的錢蓋過「發不出薪水」的情況） */
const toMidnightBroke = (g) => {
  const day = g.s.day;
  let guard = 0;
  while (g.s.day === day && g.s.clock < 1435 && guard++ < 1e6) g.update(0.1);
  g.s.coins = 0;
  toMidnight(g);
};

test('日薪公式：人數越多基本薪資越高、能力越強越貴、掌櫃不領薪水', () => {
  const avg = { speed: 1, skill: 1 };
  assert.equal(RC.state.dailyWage(avg, 1), D.WAGE_BASE[1]);
  assert.ok(RC.state.dailyWage(avg, 3) > RC.state.dailyWage(avg, 2));
  assert.ok(RC.state.dailyWage({ speed: 1.4, skill: 1.4 }, 2) > RC.state.dailyWage({ speed: 0.8, skill: 0.8 }, 2));
  assert.equal(RC.state.dailyWage(avg, 99), D.WAGE_BASE[D.WAGE_BASE.length - 1]);
  assert.equal(RC.state.newGame().staff[0].wage, 0);
});

test('雇用不扣錢：只記下日薪；手上要有至少一天的薪水才能雇', () => {
  const g = mk(1, (s) => ((s.coins = 1000), (s.level = 5)));
  const cand = g.s.candidates[0];
  const wage = RC.state.dailyWage(cand, g.s.staff.length);
  assert.equal(g.hire(0).ok, true);
  assert.equal(g.s.coins, 1000, '雇用當下不扣金幣');
  assert.equal(g.s.staff[1].wage, wage);
  assert.equal(g.s.staff[1].unpaid, 0);
  const poor = mk(2, (s) => ((s.coins = 10), (s.level = 5)));
  const r = poor.hire(0);
  assert.equal(r.ok, false);
  assert.ok(/日薪/.test(r.msg), r.msg);
  assert.equal(poor.s.staff.length, 1);
});

test('午夜發日薪：從金幣扣除、掌櫃不領、工資加總正確', () => {
  const g = mk(3, (s) => ((s.coins = 5000), (s.level = 12)));
  g.hire(0);
  g.hire(1);
  const total = g.s.staff.reduce((n, m) => n + m.wage, 0);
  assert.ok(total > 0);
  g.setBusinessHours(1, 2); // 今天剩下的時間都不營業，金幣只會因為發薪而減少
  const coins0 = g.s.coins;
  let wagesEvent = -1;
  g.on('newday', (e) => (wagesEvent = e.wages));
  toMidnight(g);
  assert.equal(wagesEvent, total);
  assert.equal(coins0 - g.s.coins, total, '午夜從金幣扣掉全部日薪');
});

test('金幣不夠：領不到的員工累積欠薪，連續 3 天就離職；有錢發薪就歸零', () => {
  const g = mk(4, (s) => ((s.coins = 5000), (s.level = 12)));
  g.hire(0);
  const id = g.s.staff[1].id;
  g.setBusinessHours(1, 2); // 今天剩下的時間都不營業，不會賺錢
  toMidnightBroke(g);
  assert.equal(g.s.staff.find((m) => m.id === id).unpaid, 1);
  g.s.coins = 100000;
  toMidnight(g);
  assert.equal(g.s.staff.find((m) => m.id === id).unpaid, 0, '發得出薪水就歸零');
  const quits = [];
  g.on('toast', (e) => /辭職/.test(e.msg) && quits.push(e.msg));
  for (let d = 0; d < D.WAGE_QUIT_DAYS; d++) {
    toMidnightBroke(g);
  }
  assert.equal(g.s.staff.some((m) => m.id === id), false, '連續欠薪 3 天辭職');
  assert.equal(quits.length, 1);
  assert.equal(g.crew.some((m) => m.id === id), false);
  assert.equal(g.s.staff[0].boss, true, '掌櫃不會離職');
});

test('離線補算期間不會因為欠薪離職，只累積天數（上限是離職前一天）', () => {
  const g = mk(5, (s) => ((s.coins = 5000), (s.level = 12)));
  g.hire(0);
  g.setBusinessHours(1, 2);
  g.offline = true;
  for (let d = 0; d < 6; d++) toMidnightBroke(g);
  g.offline = false;
  assert.equal(g.s.staff.length, 2, '離線期間不會有人離職');
  assert.ok(g.s.staff[1].unpaid <= D.WAGE_QUIT_DAYS);
});

test('舊存檔（員工是一次買斷）：載入時依能力補上日薪，掌櫃為 0；日薪與欠薪會存檔', () => {
  const s = RC.state.newGame(RC.util.makeRng(6));
  s.coins = 1000;
  s.level = 12;
  const g = new RC.Game(s, { seed: 6 });
  g.hire(0);
  const raw = JSON.parse(JSON.stringify(g.s));
  const w = raw.staff[1].wage;
  raw.staff[1].unpaid = 2;
  const keep = RC.state.normalize(raw);
  assert.equal(keep.staff[1].wage, w);
  assert.equal(keep.staff[1].unpaid, 2);
  delete raw.staff[1].wage;
  delete raw.staff[1].unpaid;
  raw.staff[0].wage = 999; // 掌櫃永遠 0
  const legacy = RC.state.normalize(raw);
  assert.equal(legacy.staff[0].wage, 0);
  assert.equal(legacy.staff[1].wage, RC.state.dailyWage(legacy.staff[1], 1));
  assert.equal(legacy.staff[1].unpaid, 0);
});
