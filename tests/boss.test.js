'use strict';
// 店掌櫃：玩家本人，不可開除、可改名；桌上的金幣只有他能收。
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');

const mk = (seed = 1) => new RC.Game(RC.state.newGame(RC.util.makeRng(seed)), { seed });
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

test('點擊金幣：掌櫃走到桌邊收款，其他員工絕不碰', () => {
  const g = mk(7);
  g.s.coins = 1e5;
  g.s.level = 3;
  g.hire(0);
  g.hire(1);
  let collected = false;
  for (let i = 0; i < 6000 && !collected; i++) {
    g.update(0.1);
    for (const m of g.crew) if (!m.boss) assert.ok(m.state !== 'to_coin' && m.state !== 'collecting', '員工不該收錢');
    const key = Object.keys(g.s.drops)[0];
    if (key && !g.coinClaimed(key)) {
      const [x, y] = key.split(',').map(Number);
      const before = g.s.coins;
      assert.equal(g.requestCollect(x, y).ok, true);
      assert.equal(g.s.coins, before, '點下去不會立刻入帳，要等掌櫃走過去');
      let steps = 0;
      const boss = g.crew.find((m) => m.boss);
      let sawWalk = false;
      while (g.s.drops[key] && steps++ < 600) {
        g.update(0.1);
        if (boss.state === 'to_coin') sawWalk = true;
        for (const m of g.crew) if (!m.boss) assert.ok(m.state !== 'to_coin' && m.state !== 'collecting');
      }
      assert.ok(!g.s.drops[key], '掌櫃最後有收到');
      assert.ok(sawWalk || steps < 3);
      assert.equal(g.s.stats.collects, 1);
      collected = true;
    }
  }
  assert.ok(collected);
});

test('掌櫃煮到一半不會被收款打斷，煮完才去收', () => {
  const g = mk(11);
  g.s.drops['3,4'] = 40; // 桌上預先放一堆金幣
  let asked = false;
  let cookingUntilDone = true;
  let collected = false;
  for (let i = 0; i < 3000 && !collected; i++) {
    g.update(0.1);
    const boss = g.crew[0];
    if (!asked && boss.state === 'cooking') {
      assert.equal(g.requestCollect(3, 4).ok, true);
      asked = true;
    }
    if (asked && !g.s.drops['3,4']) collected = true;
    if (asked && !collected && boss.state !== 'cooking' && boss.state !== 'to_serve' && boss.state !== 'serving' && boss.state !== 'to_coin' && boss.state !== 'collecting' && boss.state !== 'idle') cookingUntilDone = false;
  }
  assert.ok(asked, '應該曾經在烹飪中');
  assert.ok(collected, '最後有收到金幣');
  assert.ok(cookingUntilDone);
});

test('版面變動打斷收款：差事不會遺失', () => {
  const g = mk(5);
  g.s.drops['3,4'] = 25;
  g.requestCollect(3, 4);
  g.update(0.1);
  const boss = g.crew[0];
  assert.equal(boss.state, 'to_coin');
  g.buyFurniture('plant_pot');
  g.placeFromInventory('plant_pot', 7, 7, 0); // 版面變動 → 所有工作被取消
  assert.equal(g.coinClaimed('3,4'), true);
  run(g, 30);
  assert.ok(g.s.stats.collects >= 1, '被打斷的收款最後仍然完成');
  assert.notEqual(g.s.drops['3,4'], 25, '原本那堆 25 金幣已被收走');
});

test('收銀機：金幣自動入帳，不需要掌櫃', () => {
  const g = mk(7);
  g.s.items.push({ uid: 99, id: 'register', x: 7, y: 7, rot: 0 });
  g.rebuild();
  run(g, 90);
  assert.equal(Object.keys(g.s.drops).length, 0);
  assert.ok(g.s.stats.earned > 0);
});
