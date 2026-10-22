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

test('日薪公式：只看員工本身——能力越強、資歷越高越貴，和第幾個被雇用無關；掌櫃不領薪水', () => {
  const avg = { speed: 1, skill: 1, level: 1 };
  assert.equal(RC.state.dailyWage(avg), 45, '平均能力的新人');
  assert.ok(RC.state.dailyWage({ speed: 1.4, skill: 1.4, level: 1 }) > RC.state.dailyWage({ speed: 0.8, skill: 0.8, level: 1 }));
  // 資歷：等級越高越貴，Lv5 約新人的 2.8 倍、Lv10 約 7 倍、Lv15 約 14 倍（能力成長 0.02／0.03 每級不重複計價）
  const at = (lv) => RC.state.dailyWage({ speed: 1 + 0.02 * (lv - 1), skill: 1 + 0.03 * (lv - 1), level: lv });
  for (let lv = 2; lv <= 15; lv++) assert.ok(at(lv) > at(lv - 1), 'Lv' + lv);
  assert.ok(at(5) / at(1) > 2.5 && at(5) / at(1) < 3.1);
  assert.ok(at(10) / at(1) > 6.5 && at(10) / at(1) < 8);
  assert.ok(at(15) / at(1) > 13 && at(15) / at(1) < 16);
  assert.equal(RC.state.dailyWage({ speed: 1, skill: 1, level: 9, boss: true }), 0);
  assert.equal(RC.state.newGame().staff[0].wage, 0);
});

test('後來雇用的員工日薪不會比較高：同樣能力的應徵者，第 2 位和第 12 位日薪一樣', () => {
  const cand = { speed: 1.1, skill: 1.1 };
  const w = RC.state.dailyWage(cand);
  const g = mk(11, (s) => ((s.coins = 1e6), (s.level = 40)));
  for (let i = 0; i < 11; i++) {
    g.s.candidates[0] = { ...g.s.candidates[0], ...cand };
    assert.equal(g.hire(0).ok, true);
    assert.equal(g.s.staff[g.s.staff.length - 1].wage, w, `第 ${i + 2} 位員工`);
  }
});

test('升級後日薪跟著資歷調整；舊存檔載入時依能力與資歷重算（不再依到職順序）', () => {
  const g = mk(12, (s) => ((s.coins = 5000), (s.level = 12)));
  g.hire(0);
  const rec = g.s.staff[1];
  const w1 = rec.wage;
  rec.xp = D.STAFF_XP_STEPS[rec.level] - 1;
  g.gainStaffXp(rec);
  assert.equal(rec.level, 2);
  assert.ok(rec.wage > w1, '升級後日薪變高');
  assert.equal(rec.wage, RC.state.dailyWage(rec));
  const raw = JSON.parse(JSON.stringify(g.s));
  raw.staff[1].wage = 99999;
  assert.equal(RC.state.normalize(raw).staff[1].wage, rec.wage);
});

test('雇用不扣錢：只記下日薪；手上要有至少一天的薪水才能雇', () => {
  const g = mk(1, (s) => ((s.coins = 1000), (s.level = 5)));
  const cand = g.s.candidates[0];
  const wage = RC.state.dailyWage(cand);
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
  g.setWelfare(0); // 福利金另有測試（welfare.test.js）
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
  assert.equal(legacy.staff[1].wage, RC.state.dailyWage(legacy.staff[1]));
  assert.equal(legacy.staff[1].unpaid, 0);
});

/* ───────── 加薪：日薪與能力一起提升 ───────── */

test('加薪 0～20%：日薪照比例增加、速度與技術同步提升；超出範圍或掌櫃會被拒絕', () => {
  const g = mk(8, (s) => ((s.coins = 5000), (s.level = 12)));
  g.hire(0);
  const rec = g.s.staff[1];
  const base = rec.wage;
  assert.equal(rec.raise, 0);
  assert.equal(g.wageOf(rec), base);
  assert.equal(g.speedOf(rec), rec.speed);
  assert.equal(g.setRaise(rec.id, 20).ok, true);
  assert.equal(rec.raise, 20);
  assert.equal(g.wageOf(rec), Math.round(base * 1.2));
  const boost = 1 + (D.RAISE.abilityPerPct * 20) / 100;
  assert.ok(Math.abs(g.speedOf(rec) - rec.speed * boost) < 1e-9);
  assert.ok(Math.abs(g.skillOf(rec) - rec.skill * boost) < 1e-9);
  assert.ok(boost > 1 && boost <= 1.1 + 1e-9);
  assert.equal(g.setRaise(rec.id, 21).ok, false);
  assert.equal(g.setRaise(rec.id, -1).ok, false);
  assert.equal(g.setRaise(rec.id, 'abc').ok, false);
  assert.equal(rec.raise, 20, '失敗不會改動');
  assert.equal(g.setRaise(g.s.staff[0].id, 10).ok, false, '店掌櫃不領薪水');
  assert.equal(g.setRaise(9999, 5).ok, false);
  assert.equal(g.setRaise(rec.id, 7.4).ok, true);
  assert.equal(rec.raise, 7, '四捨五入成整數');
  g.setRaise(rec.id, 0);
  assert.equal(g.speedOf(rec), rec.speed, '調回 0% 能力就恢復（不是永久加成）');
});

test('午夜按加薪後的日薪發放；加薪的員工動作更快（同樣工作花的時間更短）', () => {
  const g = mk(9, (s) => ((s.coins = 5000), (s.level = 12)));
  g.hire(0);
  g.hire(1);
  g.setRaise(g.s.staff[1].id, 20);
  const total = g.wageOf(g.s.staff[1]) + g.wageOf(g.s.staff[2]);
  assert.equal(total, Math.round(g.s.staff[1].wage * 1.2) + g.s.staff[2].wage);
  g.setWelfare(0);
  g.setBusinessHours(1, 2);
  const coins0 = g.s.coins;
  toMidnight(g);
  assert.equal(coins0 - g.s.coins, total);
});

test('加薪存檔來回、掌櫃的加薪永遠是 0、亂填的值會被修正', () => {
  const g = mk(10, (s) => ((s.coins = 5000), (s.level = 12)));
  g.hire(0);
  g.setRaise(g.s.staff[1].id, 12);
  const back = RC.state.parse(RC.state.serialize(g.s));
  assert.equal(back.staff[1].raise, 12);
  const raw = JSON.parse(JSON.stringify(g.s));
  raw.staff[1].raise = 999;
  raw.staff[0].raise = 15;
  const fixed = RC.state.normalize(raw);
  assert.equal(fixed.staff[1].raise, D.RAISE.max);
  assert.equal(fixed.staff[0].raise, 0);
  delete raw.staff[1].raise;
  assert.equal(RC.state.normalize(raw).staff[1].raise, 0, '舊存檔沒有加薪欄位：視為 0%');
});
