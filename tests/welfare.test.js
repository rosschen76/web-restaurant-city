'use strict';
// 員工福利：福利金（薪資的 %）、分紅（盈餘的 %）、士氣（員工越多越難維持），以及員工名額上限 16 位
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;
const M = D.MORALE;

const mk = (seed = 1, mut) => {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  if (mut) mut(s);
  return new RC.Game(s, { seed });
};
/** 雇滿 n 位員工（不含掌櫃） */
function staffed(n, seed = 1) {
  const g = mk(seed, (s) => ((s.coins = 1e7), (s.level = 50)));
  for (let i = 0; i < n; i++) assert.equal(g.hire(i % 3).ok, true);
  return g;
}
const toMidnight = (g) => {
  const day = g.s.day;
  let guard = 0;
  while (g.s.day === day && guard++ < 1e6) g.update(0.1);
  assert.ok(guard < 1e6);
};
/** 直接結算一天（不用等整天模擬）：營收 earned、不營業 */
const payday = (g, earned = 0) => g.payWages(earned);

test('預設：福利金 5%、分紅 0%、士氣 60；設定範圍 0～20%，超出會被拒絕', () => {
  const g = mk(1);
  assert.equal(g.s.welfare, M.welfareDefault);
  assert.equal(g.s.bonus, 0);
  assert.equal(g.s.morale, M.start);
  assert.equal(g.setWelfare(20).ok, true);
  assert.equal(g.s.welfare, 20);
  assert.equal(g.setWelfare(21).ok, false);
  assert.equal(g.setWelfare(-1).ok, false);
  assert.equal(g.setBonus(20).ok, true);
  assert.equal(g.setBonus(25).ok, false);
  assert.equal(g.s.bonus, 20);
});

test('福利金：午夜按實際發出的薪資總額提撥，另外從金幣扣', () => {
  const g = staffed(3);
  g.setWelfare(10);
  const coins0 = g.s.coins;
  const total = g.s.staff.reduce((n, m) => n + g.wageOf(m), 0);
  const r = payday(g);
  assert.equal(r.paid, total);
  assert.equal(r.welfare, Math.round(total * 0.1));
  assert.equal(coins0 - g.s.coins, total + r.welfare);
  assert.equal(r.bonus, 0);
});

test('分紅：當天盈餘（營收 − 薪資 − 福利金）的 %，賺不到錢就不發', () => {
  const g = staffed(2);
  g.setWelfare(10);
  g.setBonus(10);
  const total = g.s.staff.reduce((n, m) => n + g.wageOf(m), 0);
  const welfare = Math.round(total * 0.1);
  let r = payday(g, total + welfare + 1000);
  assert.equal(r.bonus, 100);
  r = payday(g, total); // 賺的錢連薪水都不夠
  assert.equal(r.bonus, 0);
  g.setBonus(0);
  assert.equal(payday(g, 1e6).bonus, 0);
  const solo = mk(2);
  solo.setBonus(20);
  assert.equal(payday(solo, 1e6).bonus, 0, '只有店掌櫃沒有員工可分');
});

test('金幣不夠：福利金與分紅只付得出的部分，金幣不會變負數', () => {
  const g = staffed(3);
  g.setWelfare(20);
  g.setBonus(20);
  const total = g.s.staff.reduce((n, m) => n + g.wageOf(m), 0);
  g.s.coins = total + 3;
  const r = payday(g, 1e6);
  assert.equal(r.paid, total);
  assert.equal(r.welfare, 3);
  assert.equal(r.bonus, 0);
  assert.equal(g.s.coins, 0);
});

test('士氣每天朝目標靠近；福利金、分紅越高目標越高，員工越多目標越低', () => {
  const target = (n, w, b) => {
    const g = staffed(n);
    g.setWelfare(w);
    g.setBonus(b);
    return g.welfareForecast().target;
  };
  assert.ok(target(4, 20, 0) > target(4, 5, 0));
  assert.ok(target(4, 5, 20) > target(4, 5, 0));
  assert.ok(target(12, 5, 0) < target(4, 5, 0), '員工多了更難帶');
  assert.ok(target(16, 5, 0) < target(12, 5, 0));
  // 往目標靠近
  const g = staffed(4);
  g.setWelfare(20);
  const t = g.welfareForecast().target;
  const before = g.s.morale;
  payday(g);
  assert.ok(g.s.morale > before && g.s.morale < t);
  for (let i = 0; i < 30; i++) payday(g);
  assert.ok(Math.abs(g.s.morale - t) < 1);
  // 16 位員工要維持高士氣，得同時拉高福利金與分紅
  assert.ok(target(16, 5, 0) < M.lowBelow, '預設政策撐不住 16 位員工');
  assert.ok(target(16, 20, 20) > 80);
});

test('士氣影響速度與技術：高於 60 提升（最多 +7%）、低於 60 下降（最多 -10%）', () => {
  const g = mk(3);
  const rec = g.s.staff[0];
  g.s.morale = 60;
  assert.equal(g.moraleBoost(), 1);
  g.s.morale = 100;
  assert.ok(Math.abs(g.moraleBoost() - 1.07) < 1e-9);
  assert.ok(Math.abs(g.speedOf(rec) - rec.speed * 1.07) < 1e-9);
  g.s.morale = 0;
  assert.ok(Math.abs(g.moraleBoost() - 0.9) < 1e-9);
  g.s.morale = 30;
  assert.ok(g.skillOf(rec) < rec.skill);
});

test('士氣連續 3 天過低：一位沒有擔任店長、資歷最淺的員工離職，士氣回升一些', () => {
  const g = staffed(14); // 人多又沒有福利：目標士氣只有 10
  g.setWelfare(0);
  g.setBonus(0);
  g.s.staff[2].level = 4;
  g.s.morale = 10;
  const n0 = g.s.staff.length;
  payday(g);
  payday(g);
  assert.equal(g.s.staff.length, n0, '前兩天只警告');
  assert.equal(g.s.lowMorale, 2);
  const lowest = g.s.staff.filter((m) => !m.boss && !m.manager).sort((a, b) => a.level - b.level || b.id - a.id)[0].id;
  const r = payday(g);
  assert.equal(r.quits, 1);
  assert.equal(g.s.staff.length, n0 - 1);
  assert.equal(g.s.staff.some((m) => m.id === lowest), false);
  assert.equal(g.crew.some((m) => m.id === lowest), false);
  assert.equal(g.s.lowMorale, 0);
  assert.equal(g.s.staff[0].boss, true);
  // 離線補算不會有人離職
  const h = staffed(14);
  h.setWelfare(0);
  h.s.morale = 5;
  h.offline = true;
  for (let i = 0; i < 6; i++) payday(h);
  assert.equal(h.s.staff.length, 15);
});

test('士氣回到門檻以上，低士氣天數歸零', () => {
  const g = staffed(5);
  g.s.morale = 10;
  g.s.lowMorale = 2;
  g.setWelfare(20);
  g.setBonus(20);
  for (let i = 0; i < 12; i++) payday(g);
  assert.equal(g.s.lowMorale, 0);
  assert.ok(g.s.morale > M.lowBelow);
});

test('領不到薪水的員工拉低目標士氣', () => {
  const a = staffed(4);
  const b = staffed(4);
  b.s.coins = 0;
  const ma = a.s.morale;
  payday(a);
  payday(b);
  assert.ok(b.s.morale < a.s.morale);
  assert.ok(ma >= 0);
});

test('午夜結算會一起處理：事件、日誌提示都含福利金與分紅', () => {
  const g = staffed(2);
  g.setWelfare(10);
  g.setBonus(10);
  g.setBusinessHours(1, 2);
  g.s.coins = 100000;
  const msgs = [];
  g.on('toast', (e) => msgs.push(e.msg));
  let ev = null;
  g.on('newday', (e) => (ev = e));
  const total = g.s.staff.reduce((n, m) => n + g.wageOf(m), 0);
  toMidnight(g);
  assert.equal(ev.wages, total + Math.round(total * 0.1), '事件的支出含福利金');
  assert.ok(msgs.some((m) => /福利金/.test(m)), msgs.join('|'));
});

test('存檔來回、舊存檔補預設、亂填的值被修正', () => {
  const g = staffed(2);
  g.setWelfare(12);
  g.setBonus(7);
  g.s.morale = 33.5;
  g.s.lowMorale = 2;
  const back = RC.state.parse(RC.state.serialize(g.s));
  assert.equal(back.welfare, 12);
  assert.equal(back.bonus, 7);
  assert.equal(back.morale, 33.5);
  assert.equal(back.lowMorale, 2);
  const raw = JSON.parse(JSON.stringify(g.s));
  raw.welfare = 99;
  raw.bonus = -5;
  raw.morale = 500;
  const fixed = RC.state.normalize(raw);
  assert.equal(fixed.welfare, M.welfareMax);
  assert.equal(fixed.bonus, 0);
  assert.equal(fixed.morale, 100);
  for (const k of ['welfare', 'bonus', 'morale', 'lowMorale']) delete raw[k];
  const legacy = RC.state.normalize(raw);
  assert.deepEqual([legacy.welfare, legacy.bonus, legacy.morale, legacy.lowMorale], [M.welfareDefault, 0, M.start, 0]);
});

test('員工名額到 16 位：能雇滿 16 位、第 17 位被拒絕', () => {
  const g = mk(5, (s) => ((s.coins = 1e7), (s.level = 42)));
  for (let i = 0; i < 16; i++) assert.equal(g.hire(i % 3).ok, true, '第 ' + (i + 1) + ' 位');
  const r = g.hire(0);
  assert.equal(r.ok, false);
  assert.ok(/上限/.test(r.msg));
});
