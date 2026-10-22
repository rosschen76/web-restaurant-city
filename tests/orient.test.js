'use strict';
// 裝潢：自動朝向（椅子面向桌子、收銀機／冰箱／點唱機正面朝向走道）
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;
const W = RC.world;

function mk(items) {
  const s = RC.state.newGame(RC.util.makeRng(1));
  s.items = [];
  s.nextUid = 1;
  for (const [id, x, y, rot] of items) s.items.push({ uid: s.nextUid++, id, x, y, rot: rot || 0 });
  return new RC.Game(s, { seed: 1, dayMode: false });
}
const rotOf = (g, uid) => g.s.items.find((i) => i.uid === uid).rot;

test('哪些家具有方向：椅子與收銀機、冰箱（三種）、點唱機；桌子、爐灶、裝飾沒有', () => {
  for (const id of ['chair_stool', 'chair_wood', 'chair_gold', 'register', 'fridge', 'fridge_big', 'freezer', 'jukebox']) {
    assert.equal(W.isOriented(D.furniture[id]), true, id);
    assert.ok(D.furniture[id].rot || D.furniture[id].cat === 'chair', id + ' 要能旋轉');
  }
  for (const id of ['table_wood', 'table_long', 'stove_gas', 'sink', 'plant_pot', 'piano', 'screen']) assert.equal(W.isOriented(D.furniture[id]), false, id);
});

test('椅子：面向緊鄰的桌子；已經面向桌子就不動；旁邊沒有桌子維持原樣', () => {
  const g = mk([['table_wood', 4, 4, 0], ['chair_wood', 3, 4, 2], ['chair_wood', 4, 3, 0], ['chair_wood', 4, 5, 2], ['chair_wood', 0, 7, 3]]);
  // 椅 1 在桌子左邊：要面向右（0）；椅 2 在桌子上方：面向下（1）；椅 3 在桌子下方：面向上（3）
  assert.equal(W.suggestRot(g.grid, D.furniture.chair_wood, 3, 4, 2, 2), 0);
  assert.equal(W.suggestRot(g.grid, D.furniture.chair_wood, 4, 3, 0, 3), 1);
  assert.equal(W.suggestRot(g.grid, D.furniture.chair_wood, 4, 5, 2, 4), 3);
  assert.equal(W.suggestRot(g.grid, D.furniture.chair_wood, 0, 7, 3, 5), 3, '旁邊沒桌子維持原本方向');
  const r = g.autoRotateAll();
  assert.equal(r.ok, true);
  assert.equal(r.changed, 3, '三張椅子轉到面向桌子');
  assert.deepEqual([2, 3, 4].map((u) => rotOf(g, u)), [0, 1, 3]);
  assert.equal(rotOf(g, 5), 3);
  assert.equal(g.autoRotateAll().changed, 0, '再整理一次不會再有變動');
  // 轉向後座位的面向和椅子方向一致
  for (const seat of g.seats) assert.equal(seat.face, rotOf(g, seat.uid));
});

test('椅子夾在兩張桌子中間：維持玩家選的那一邊', () => {
  const g = mk([['table_wood', 2, 4, 0], ['chair_wood', 3, 4, 0], ['table_wood', 4, 4, 0]]);
  assert.equal(W.suggestRot(g.grid, D.furniture.chair_wood, 3, 4, 0, 2), 0);
  assert.equal(W.suggestRot(g.grid, D.furniture.chair_wood, 3, 4, 2, 2), 2);
});

test('有正面的家具：正面朝向走道；正面被擋住就轉到最靠近房間中央的空格', () => {
  // 收銀機靠在左上角：往上是牆外、往左是牆外；右邊與下面是空的
  const g = mk([['register', 0, 0, 3]]);
  const def = D.furniture.register;
  const rot = W.suggestRot(g.grid, def, 0, 0, 3, 1);
  assert.ok(rot === 0 || rot === 1, '朝向房間裡面：' + rot);
  g.autoRotateItem(1);
  assert.equal(rotOf(g, 1), rot);
  // 目前方向就是空格：不動
  const h = mk([['fridge', 4, 4, 2]]);
  assert.equal(W.suggestRot(h.grid, D.furniture.fridge, 4, 4, 2, 1), 2);
  const r = h.autoRotateItem(1);
  assert.equal(r.ok, true);
  assert.equal(r.changed, false);
  // 面前有東西擋住：轉向別的空格
  const k = mk([['jukebox', 4, 4, 0], ['table_wood', 5, 4, 0]]);
  const nr = W.suggestRot(k.grid, D.furniture.jukebox, 4, 4, 0, 1);
  assert.notEqual(nr, 0);
  assert.ok([1, 2, 3].includes(nr));
  // 四面都被擋住：維持原樣
  const z = mk([['fridge', 4, 4, 1], ['table_wood', 5, 4, 0], ['table_wood', 3, 4, 0], ['table_wood', 4, 3, 0], ['table_wood', 4, 5, 0]]);
  assert.equal(W.suggestRot(z.grid, D.furniture.fridge, 4, 4, 1, 1), 1);
});

test('沒有方向的家具不能自動轉向；找不到物品會失敗', () => {
  const g = mk([['table_wood', 4, 4, 0]]);
  assert.equal(g.autoRotateItem(1).ok, false);
  assert.equal(g.autoRotateItem(99).ok, false);
  assert.equal(g.autoRotateAll().changed, 0);
});

test('存檔裡收銀機、冰箱、點唱機的方向會保留', () => {
  const g = mk([['register', 5, 0, 1], ['fridge', 6, 0, 2], ['jukebox', 7, 1, 3]]);
  const back = RC.state.parse(RC.state.serialize(g.s));
  assert.deepEqual(back.items.filter((i) => i.id !== 'sink').map((i) => i.rot), [1, 2, 3]);
});
