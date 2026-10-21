'use strict';
// 風評（-10 ~ +10）與遊戲終止；洗碗與餐具。
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;
const REP = D.REPUTATION;

const mk = (seed = 1, opts = {}, mut) => {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  if (mut) mut(s);
  return new RC.Game(s, { seed, ...opts });
};
const run = (g, sec, dt = 0.1) => {
  for (let t = 0; t < sec; t += dt) g.update(dt);
};
function party(g, size) {
  return { id: g.nextPid++, size, looks: Array.from({ length: size }, () => RC.state.makeLook(g.rng)), vip: false, vipTitle: null, p: 1, tableUid: null, dined: 0 };
}

/* ───────── 風評 ───────── */

test('風評：客人滿意加分、氣走扣分、候位逾時／候位已滿扣分，且限制在 -10 ~ +10', () => {
  const g = mk(1, { dayMode: false });
  assert.equal(g.s.reputation, 0);
  // 滿意：結帳離開
  const p = party(g, 1);
  g.queue.push(p);
  g.seatQueue();
  const c = g.customers.find((x) => x.party === p.id);
  Object.assign(c, { state: 'wait_pay', bill: 20, tipBase: 10, payWait: 0, dish: 'danbing', servedP: 1, fade: 1 });
  g.settle(c, {});
  assert.ok(Math.abs(g.s.reputation - (REP.happy + REP.fastBonus)) < 1e-9, '快速結帳加最多：' + g.s.reputation);
  // 自助結帳（沒人收）加很少
  const before = g.s.reputation;
  const p2 = party(g, 1);
  g.queue.push(p2);
  g.seatQueue();
  const c2 = g.customers.find((x) => x.party === p2.id);
  Object.assign(c2, { state: 'wait_pay', bill: 20, tipBase: 0, payWait: 0, dish: 'danbing', servedP: 1, fade: 1 });
  g.settle(c2, { noTip: true });
  assert.ok(Math.abs(g.s.reputation - before - REP.selfCheckout) < 1e-9);
  // 氣走（用乾淨的遊戲，確保這組客人真的入座）
  const g3 = mk(2, { dayMode: false });
  g3.spawnTimer = 1e9;
  const p3 = party(g3, 2);
  g3.queue.push(p3);
  g3.seatQueue();
  assert.equal(g3.customers.filter((x) => x.party === p3.id).length, 2);
  g3.sendParty(p3.id, true);
  assert.equal(g3.s.reputation, REP.angry, '整組氣走只扣一次');
  // 候位逾時
  const g4 = mk(3, { dayMode: false });
  g4.spawnTimer = 1e9;
  for (const uid of g4.tables.keys()) g4.tableParty.set(uid, 999);
  g4.queue.push(party(g4, 2));
  run(g4, D.QUEUE_PATIENCE + 3);
  assert.ok(Math.abs(g4.s.reputation - REP.walkout) < 1e-9);
  // 候位已滿，客人直接掉頭
  const g5 = mk(4, { dayMode: false });
  for (const uid of g5.tables.keys()) g5.tableParty.set(uid, 999);
  g5.s.reputation = 0;
  for (let i = 0; i < 30; i++) g5.trySpawn();
  assert.ok(g5.s.reputation < 0 && g5.s.reputation >= -30 * 0.15 - 1e-9);
  // 上下限
  g.adjustRep(-100);
  assert.equal(g.s.reputation, REP.min);
  g.adjustRep(100);
  assert.equal(g.s.reputation, REP.max);
});

test('風評影響客人上門的頻率：好評更常來、負評變少', () => {
  const avg = (rep) => {
    const g = mk(5, { dayMode: false });
    g.s.reputation = rep;
    let t = 0;
    for (let i = 0; i < 2000; i++) t += g.spawnInterval();
    return t / 2000;
  };
  const good = avg(10);
  const mid = avg(0);
  const bad = avg(-10);
  assert.ok(good < mid && mid < bad, `好評 ${good.toFixed(2)}s < 普通 ${mid.toFixed(2)}s < 負評 ${bad.toFixed(2)}s`);
  assert.ok(bad / good > 1.5, '差距要明顯');
});

/* ───────── 遊戲終止 ───────── */

test('風評連續 15 天停在 -10：餐廳倒閉、遊戲終止', () => {
  const g = mk(2);
  g.s.reputation = REP.min;
  const warns = [];
  g.on('toast', (e) => /谷底/.test(e.msg) && warns.push(e.msg));
  let over = null;
  g.on('gameover', (e) => (over = e));
  for (let d = 1; d <= 14; d++) {
    g.endDay();
    assert.equal(g.s.lowDays, d);
    assert.equal(g.s.over, null, `第 ${d} 天還沒倒閉`);
  }
  assert.ok(warns.length >= 4, '沿途有提醒：' + warns.length);
  g.endDay();
  assert.equal(g.s.lowDays, 15);
  assert.ok(g.s.over && g.s.over.reason === 'reputation');
  assert.ok(over && over.day === g.s.day);
  // 終止之後遊戲不再前進
  const snap = JSON.stringify([g.s.clock, g.s.day, g.s.stats]);
  run(g, 60);
  assert.equal(JSON.stringify([g.s.clock, g.s.day, g.s.stats]), snap);
  assert.equal(g.catchUp(3600), null);
});

test('風評只要有一天離開谷底，連續天數就歸零重算', () => {
  const g = mk(3);
  g.s.reputation = REP.min;
  for (let i = 0; i < 10; i++) g.endDay();
  assert.equal(g.s.lowDays, 10);
  g.s.reputation = REP.min + 0.2; // 回到 -9.8：不再算谷底
  g.endDay();
  assert.equal(g.s.lowDays, 0);
  g.s.reputation = REP.min;
  for (let i = 0; i < 14; i++) g.endDay();
  assert.equal(g.s.over, null, '重新計算後，14 天還不會倒閉');
  g.endDay();
  assert.ok(g.s.over);
});

test('離線期間不會累計谷底天數：人不在的時候餐廳不會倒閉', () => {
  const g = mk(4);
  g.s.reputation = REP.min;
  g.s.lowDays = 14;
  const r = g.catchUp(8 * 3600); // 離線 8 小時 → 模擬好幾十天
  assert.ok(r.days >= 10, '離線期間經過了多天：' + r.days);
  assert.equal(g.s.over, null);
  assert.equal(g.s.lowDays, 14, '谷底天數凍結');
  assert.equal(g.offline, false);
});

test('遊戲終止資訊會存檔，載入後仍是終止狀態；異常存檔值會被修正', () => {
  const g = mk(5);
  g.s.reputation = REP.min;
  g.s.lowDays = 14;
  g.endDay();
  const back = RC.state.parse(RC.state.serialize(g.s));
  assert.ok(back.over && back.over.reason === 'reputation');
  assert.equal(back.over.day, g.s.over.day);
  assert.equal(back.lowDays, 15);
  assert.equal(back.reputation, REP.min);
  const bad = RC.state.normalize({ reputation: 99, lowDays: -5, day: 0, clock: 99999, schedule: { open: 20, close: 10 }, over: 'x' });
  assert.equal(bad.reputation, REP.max);
  assert.equal(bad.lowDays, 0);
  assert.equal(bad.day, 1);
  assert.ok(bad.clock < 1440);
  assert.deepEqual([bad.schedule.open, bad.schedule.close], [9, 17], '營業時間不合理就回到預設');
  assert.equal(bad.over, null);
});

test('風評谷底在正常經營中真的會發生並終止：關掉所有員工的服務', () => {
  // 沒有任何爐灶 → 客人不會上門 → 風評不會變差。改用「有客人卻沒人服務」：爐灶有、員工全都不在班時段外
  const g = mk(6, {}, (s) => (s.staff[0].shift = 9));
  g.s.reputation = 0;
  let steps = 0;
  // 讓員工一直在忙著等盤子（沒有洗碗槽）→ 客人一直氣走
  g.s.items = g.s.items.filter((i) => i.id !== 'sink');
  g.rebuild();
  g.s.sinkDirty = 9999;
  while (!g.s.over && steps++ < 4e6) g.update(0.1);
  assert.ok(g.s.over, '長期經營不善最後會倒閉（步數 ' + steps + '）');
  assert.equal(g.s.reputation, REP.min);
  assert.ok(g.s.lowDays >= REP.loseDays);
  assert.ok(g.s.stats.angry > 20);
});

/* ───────── 洗碗與餐具 ───────── */

test('洗碗流程：客人走後收桌 → 端去洗碗槽 → 有人洗 → 盤子循環使用', () => {
  const g = mk(7, { dayMode: false });
  g.s.coins = 1e5;
  g.s.level = 3;
  g.hire(0); // 掌櫃一個人忙不過來，雇一位員工幫忙
  const total = g.plateTotal();
  assert.equal(total, D.PLATES.base + D.PLATES.perSeat * g.seats.length);
  assert.equal(g.cleanPlates(), total);
  let washed = 0;
  let dropped = 0;
  g.on('washed', () => washed++);
  g.on('plates', () => dropped++);
  let minClean = total;
  for (let t = 0; t < 900; t += 0.1) {
    g.update(0.1);
    minClean = Math.min(minClean, g.cleanPlates());
    assert.ok(g.s.sinkDirty >= 0 && g.cleanPlates() >= 0 && g.cleanPlates() <= total);
  }
  assert.ok(g.s.stats.served > total * 1.5, `服務人數 ${g.s.stats.served} 遠多於盤子總數 ${total}，代表盤子有循環使用`);
  assert.ok(dropped >= 10, '員工把餐具送到洗碗槽：' + dropped);
  assert.ok(washed >= g.s.stats.served * 0.6, `洗碗次數 ${washed}`);
});

test('沒有洗碗槽：盤子用完後就沒辦法出餐；補上洗碗槽後恢復', () => {
  const g = mk(8, { dayMode: false });
  g.s.items = g.s.items.filter((i) => i.id !== 'sink');
  g.rebuild();
  assert.equal(g.sinks.length, 0);
  run(g, 900);
  const stalled = g.s.stats.served;
  assert.equal(g.cleanPlates(), 0, '盤子都髒了');
  run(g, 300);
  assert.equal(g.s.stats.served, stalled, '沒有洗碗槽之後不再出餐');
  g.s.coins = 1e5;
  g.buyFurniture('sink');
  assert.equal(g.placeFromInventory('sink', 6, 0, 0).ok, true);
  assert.equal(g.sinks.length, 1);
  run(g, 400);
  assert.ok(g.s.stats.served > stalled + 5, '補上洗碗槽後恢復營運');
});

test('洗碗槽被家具擋住（沒有站位）等於沒有洗碗槽', () => {
  const g = mk(9, { dayMode: false });
  const sk = g.s.items.find((i) => i.id === 'sink');
  g.s.coins = 1e5;
  let n = 0;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1]]) {
    g.buyFurniture('plant_pot');
    if (g.placeFromInventory('plant_pot', sk.x + dx, sk.y + dy, 0).ok) n++;
  }
  assert.ok(n >= 2);
  assert.equal(g.sinks.length, 0, '洗碗槽周圍都被擋住');
});

test('盤子不夠時不接新單，員工改去收桌子、洗碗，不會互相等死', () => {
  const g = mk(10, { dayMode: false });
  g.spawnTimer = 1e9;
  // 製造「盤子全髒了」：3 組客人用完餐留在桌上、其餘在洗碗槽
  g.s.sinkDirty = g.plateTotal() - 2;
  for (const c of g.customers) c.plate = false;
  assert.equal(g.cleanPlates(), 2);
  const p = party(g, 2);
  g.queue.push(p);
  g.seatQueue();
  for (const c of g.customers.filter((x) => x.party === p.id)) c.plate = true; // 預留了兩個盤子
  assert.equal(g.cleanPlates(), 0);
  // 沒有乾淨盤子：員工不接點餐，而是去洗碗
  let claimed = 0;
  let washed = 0;
  g.on('washed', () => washed++);
  for (let t = 0; t < 60; t += 0.1) {
    g.update(0.1);
    if (g.cleanPlates() < 1) for (const c of g.customers) if (c.claimedBy != null) claimed++;
  }
  assert.ok(washed >= 3, '先洗碗：' + washed);
  assert.equal(claimed, 0, '沒有盤子時不會有人接單等著');
});

test('版面變動時，員工手上的髒盤子不會憑空消失', () => {
  const g = mk(11, { dayMode: false });
  const m = g.crew[0];
  m.carryPlates = 3;
  m.state = 'to_sink';
  const before = g.s.sinkDirty;
  g.abortJob(m);
  assert.equal(m.carryPlates, 0);
  assert.equal(g.s.sinkDirty, before + 3);
});

test('餐具會計：任意時刻 乾淨 + 各處使用中 = 總數（長時間隨機版面變動下也成立）', () => {
  const g = mk(12, { dayMode: false });
  const rng = RC.util.makeRng(99);
  g.s.coins = 1e6;
  g.s.level = 15;
  for (let i = 0; i < 2; i++) g.hire(0);
  let t = 0;
  while (t < 1200) {
    g.update(0.1);
    t += 0.1;
    if (Math.floor(t * 10) % 30 === 0) {
      const items = g.s.items.filter((i) => i.id !== 'sink' && i.id !== 'stove_gas');
      const r = rng.next();
      if (r < 0.3 && items.length) g.moveItem(rng.pick(items).uid, rng.int(0, 7), rng.int(0, 7), rng.int(0, 3));
      else if (r < 0.5 && items.length > 3) g.storeItem(rng.pick(items).uid);
      else if (r < 0.7) {
        g.buyFurniture('chair_stool');
        g.placeFromInventory('chair_stool', rng.int(0, 7), rng.int(0, 7), 0);
      }
    }
    const used = g.s.sinkDirty + g.customers.filter((c) => c.plate).length + g.parties.reduce((a, p) => a + p.dined, 0) + [...g.dirty.values()].reduce((a, d) => a + d.plates, 0) + g.crew.reduce((a, m) => a + (m.carryPlates || 0), 0);
    assert.equal(g.cleanPlates(), Math.max(0, g.plateTotal() - used));
    assert.ok(g.s.sinkDirty >= 0);
  }
});
