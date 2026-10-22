'use strict';
// 單人套餐與搭配、單品漲價與來客率
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;

function mk(seed = 1, mut, opts) {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  s.coins = 1e7;
  s.level = 50;
  if (mut) mut(s);
  return new RC.Game(s, { seed, dayMode: false, stock: false, ...opts });
}
const learn = (s, ids, menu = true) => {
  for (const id of ids) s.dishes[id] = { cooked: 0 };
  if (menu) {
    s.menu = [...ids];
    s.stock = Object.fromEntries(ids.map((id) => [id, 1e6]));
  }
};

/* ───────── 搭配分數 ───────── */

test('搭配分數：牛排配玉米濃湯加分、肉燥飯配蛋糕扣分、辣配辣扣分；範圍 -2～+2', () => {
  assert.equal(D.pairScore('steak', 'cornsoup').score, 2);
  assert.equal(D.pairScore('luroufan', 'strawcake').score, -2);
  assert.equal(D.pairScore('hotpot', 'hotsour').score, -2);
  assert.equal(D.pairScore('hotpot', 'plum').score, 2);
  assert.ok(D.pairScore('luroufan', 'meatballsoup').score >= 1, '重口主食配清爽湯');
  assert.ok(D.pairScore('steak', 'tangyuan').score < 0, '西式配中式甜湯不搭');
  assert.ok(D.pairScore('steak', 'cornsoup').why.some((t) => /經典/.test(t)));
  const dist = [0, 0, 0, 0, 0];
  const mains = D.dishList.filter((d) => d.kind === 'main');
  const others = D.dishList.filter((d) => d.kind !== 'main');
  for (const a of mains) for (const b of others) {
    const { score } = D.pairScore(a.id, b.id);
    assert.ok(Number.isInteger(score) && score >= -2 && score <= 2);
    dist[score + 2]++;
  }
  for (const n of dist) assert.ok(n > 0, '每個分數都有組合：' + dist);
  assert.ok(dist[2] > dist[0] && dist[2] > dist[4], '多數是普通搭配');
});

test('經典配對表：主餐是主餐、附餐不是主餐、菜色都存在；每道菜都有菜系與口味標籤', () => {
  for (const [a, b] of [...D.PAIR_GOOD, ...D.PAIR_BAD]) {
    assert.ok(D.dishes[a] && D.dishes[b], `${a}+${b}`);
    assert.equal(D.dishes[a].kind, 'main', a);
    assert.notEqual(D.dishes[b].kind, 'main', b);
  }
  assert.ok(D.PAIR_GOOD.length >= 20 && D.PAIR_BAD.length >= 10);
  for (const d of D.dishList) {
    assert.ok(D.CUISINE_NAMES[d.cu], d.id);
    for (const t of d.tg) assert.ok(D.TAG_NAMES[t], d.id + t);
  }
  const counts = {};
  for (const d of D.dishList) counts[d.kind] = (counts[d.kind] || 0) + 1;
  assert.ok(counts.main >= 40 && (counts.drink || 0) >= 8 && (counts.soup || 0) >= 8 && (counts.dessert || 0) >= 8 && (counts.side || 0) >= 6, JSON.stringify(counts));
});

/* ───────── 點餐 ───────── */

test('點餐：菜單只有主餐就只點一道；沒有主餐就單點；兩道菜庫存各扣一', () => {
  const only = mk(1, (s) => learn(s, ['luroufan', 'danbing']));
  for (let i = 0; i < 200; i++) assert.equal(only.pickOrder().extra, null);
  const none = mk(2, (s) => learn(s, ['soymilk', 'tangyuan']));
  for (let i = 0; i < 100; i++) {
    const o = none.pickOrder();
    assert.ok(o.dish && o.extra === null);
    assert.notEqual(D.dishes[o.dish].kind, 'main');
  }
  const g = mk(3, (s) => {
    learn(s, ['luroufan', 'meatballsoup']);
    s.stock = { luroufan: 1000, meatballsoup: 1000 };
  }, { stock: true });
  let combos = 0;
  for (let i = 0; i < 300; i++) {
    const before = { ...g.s.stock };
    const o = g.pickOrder();
    assert.equal(g.s.stock[o.dish], before[o.dish] - 1);
    if (o.extra) {
      combos++;
      assert.equal(g.s.stock[o.extra], before[o.extra] - 1);
      assert.equal(D.dishes[o.dish].kind, 'main');
    }
  }
  // 18% 單點湯；其餘 82% 點主餐，其中約一半加湯
  assert.ok(combos > 300 * 0.82 * 0.5 * 0.7 && combos < 300 * 0.82 * 0.5 * 1.3, '套餐數 ' + combos);
});

test('好搭配的附餐更常被點、地雷搭配很少被點', () => {
  const g = mk(4, (s) => learn(s, ['luroufan', 'meatballsoup', 'tiramisu']));
  const n = { meatballsoup: 0, tiramisu: 0 };
  for (let i = 0; i < 6000; i++) {
    const o = g.pickOrder();
    if (o.dish === 'luroufan' && o.extra) n[o.extra]++;
  }
  assert.ok(n.meatballsoup > n.tiramisu * 5, JSON.stringify(n));
  assert.ok(n.tiramisu > 0, '地雷也會偶爾出現');
});

test('賣完的附餐不會被點；附餐賣完後客人只點主餐', () => {
  const g = mk(5, (s) => learn(s, ['steak', 'cornsoup']), { stock: true });
  g.s.stock = { steak: 100, cornsoup: 0 };
  g.s.items.find((i) => i.id === 'stove_gas').id = 'stove_pro';
  g.rebuild();
  for (let i = 0; i < 50; i++) assert.equal(g.pickOrder().extra, null);
});

/* ───────── 烹飪、用餐、結帳 ───────── */

test('套餐：烹飪時間是兩道加總 × 0.75、需要兩道中最高的爐灶、兩道都累計熟練度', () => {
  const g = mk(6, (s) => learn(s, ['steak', 'cornsoup']));
  const c = { id: 1, dish: 'steak', extra: 'cornsoup' };
  const sum = g.cookTime('steak', 1, 1) + g.cookTime('cornsoup', 1, 1);
  assert.ok(Math.abs(g.orderCookTime(c, 1, 1) - sum * D.PAIR.cookFactor) < 1e-9);
  assert.equal(g.orderStoveNeed(c), D.stoveTier('pro'));
  assert.equal(g.orderStoveNeed({ dish: 'cornsoup', extra: null }), 0);
  assert.equal(g.orderCookTime({ dish: 'steak', extra: null }, 1, 1), g.cookTime('steak', 1, 1));
});

test('結帳：好搭配加價與多小費、地雷搭配打折；單點照原價', () => {
  const price = (g, a, b) => {
    const c = { id: 9, party: 1, dish: a, extra: b, state: 'eat', servedP: 1, vip: false };
    g.customers.push(c);
    const xp0 = g.s.xp;
    g.finishMeal(c);
    g.customers.pop();
    return { bill: c.bill, tip: c.tipBase, score: c.pairScore, xp: g.s.xp - xp0 };
  };
  const g = mk(7, (s) => {
    learn(s, ['steak', 'cornsoup', 'luroufan', 'strawcake', 'danbing']);
    s.level = 20; // 還沒滿級，經驗值才會增加
  });
  const base = (a, b) => g.dishInfo(a).price + (b ? g.dishInfo(b).price : 0);
  const single = price(g, 'steak', null);
  assert.equal(single.bill, g.dishInfo('steak').price);
  assert.equal(single.score, null);
  const good = price(g, 'steak', 'cornsoup');
  assert.equal(good.score, 2);
  assert.equal(good.bill, Math.round(base('steak', 'cornsoup') * D.PAIR.levels[2].mult));
  const bad = price(g, 'luroufan', 'strawcake');
  assert.equal(bad.score, -2);
  assert.equal(bad.bill, Math.round(base('luroufan', 'strawcake') * D.PAIR.levels['-2'].mult));
  assert.ok(bad.bill < base('luroufan', 'strawcake') && good.bill > base('steak', 'cornsoup'));
  assert.ok(good.tip / good.bill > bad.tip / bad.bill, '好搭配的小費占比更高');
  assert.ok(good.xp > single.xp * 0 && good.xp >= D.dishes.steak.xp + D.dishes.cornsoup.xp - 1, '經驗值兩道都算');
});

test('整合：菜單有主餐與附餐時，套餐會煮、送上桌、結帳；兩道菜熟練度都增加', () => {
  const g = mk(8, (s) => {
    learn(s, ['danbing', 'soymilk', 'luroufan', 'meatballsoup']);
    s.items.find((i) => i.id === 'stove_gas');
  });
  let guard = 0;
  let combo = null;
  while (guard++ < 6000 && !combo) {
    g.update(0.1);
    combo = g.customers.find((c) => c.extra && c.state === 'wait_pay');
  }
  assert.ok(combo, '應該有套餐客人吃完等結帳');
  assert.ok(g.s.dishes[combo.dish].cooked >= 1 && g.s.dishes[combo.extra].cooked >= 1);
  for (let i = 0; i < 3000; i++) g.update(0.1);
  assert.ok(g.s.stats.served > 10);
});

/* ───────── 漲價與來客率 ───────── */

test('漲價上限隨熟練度：2 級 1% … 6 級 5%；1 級不能漲價', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(D.markupCap), [0, 1, 2, 3, 4, 5]);
  const g = mk(9, (s) => {
    learn(s, ['danbing']);
    s.dishes.danbing.cooked = 0;
  });
  assert.equal(g.setMarkup('danbing', 1).ok, false);
  g.s.dishes.danbing.cooked = 8; // 熟練度 2
  assert.equal(g.setMarkup('danbing', 1).ok, true);
  assert.equal(g.setMarkup('danbing', 2).ok, false);
  g.s.dishes.danbing.cooked = 250; // 大師
  assert.equal(g.setMarkup('danbing', 5).ok, true);
  assert.equal(g.setMarkup('danbing', 6).ok, false);
  assert.equal(g.setMarkup('steak', 1).ok, false, '沒學會');
  assert.equal(g.setMarkup('danbing', 0).ok, true);
  assert.equal(g.s.markup.danbing, undefined);
});

test('漲價影響售價；熟練度不夠時實際漲價被上限壓住；降級不會發生但存檔裡超過上限的值也只算上限', () => {
  const g = mk(10, (s) => learn(s, ['danbing', 'luroufan']));
  g.s.dishes.danbing.cooked = 120; // 5 級：上限 4%
  const p0 = g.dishInfo('danbing').price;
  g.setMarkup('danbing', 4);
  const info = g.dishInfo('danbing');
  assert.equal(info.markup, 4);
  assert.equal(info.price, Math.round(D.dishes.danbing.price * (1 + 0.08 * 4) * (1 + 0.1 * g.stars) * 1.04));
  assert.ok(info.price >= p0);
  g.s.markup.luroufan = 5; // 熟練度 1，實際不漲
  assert.equal(g.markupOf('luroufan'), 0);
});

test('來客率：漲價合計越多越低；0 合計不受影響、全部漲 5% 約 -10%；只算上架品項', () => {
  assert.equal(D.arrivalRate(0), 1);
  assert.ok(Math.abs(D.arrivalRate(100) - 0.9) < 1e-9);
  assert.ok(D.arrivalRate(20) > D.arrivalRate(40) && D.arrivalRate(40) > D.arrivalRate(80));
  assert.ok(D.arrivalRate(10) > 0.99, '少漲幾道幾乎沒影響');
  const g = mk(11, (s) => {
    learn(s, ['danbing', 'soymilk', 'luroufan']);
    for (const id of s.menu) s.dishes[id].cooked = 250;
  });
  assert.equal(g.markupTotal(), 0);
  g.setMarkup('danbing', 5);
  g.setMarkup('soymilk', 3);
  assert.equal(g.markupTotal(), 8);
  g.removeMenu('soymilk');
  assert.equal(g.markupTotal(), 5, '下架的菜不算');
  const gap = (x) => {
    let n = 0;
    for (let i = 0; i < 400; i++) n += x.spawnInterval();
    return n / 400;
  };
  const a = mk(12, (s) => learn(s, ['danbing']));
  const b = mk(12, (s) => {
    learn(s, ['danbing']);
    s.dishes.danbing.cooked = 250;
    s.markup = { danbing: 5 };
  });
  assert.ok(gap(b) >= gap(a), '有漲價客人上門比較慢（單品漲 5% 影響很小）');
});

test('小漲有賺頭、全部都漲得不償失（營收期望值）', () => {
  // 20 道上架、每道占 1/20：全部漲 x% → 單價 +x%，來客率 arrivalRate(20x)
  const gain = (n, pct) => (1 + pct / 100) * D.arrivalRate(n * pct); // 相對營收（平均分配）
  const rev = (n, pct) => {
    const share = n / 20;
    return (1 + share * (pct / 100)) * D.arrivalRate(n * pct);
  };
  assert.ok(rev(5, 5) > 1, '漲 5 道各 5% 有賺');
  assert.ok(rev(20, 5) < 1, '20 道全漲 5% 賠錢');
  assert.ok(rev(20, 1) > 1, '20 道各漲 1% 小賺');
  void gain;
});

test('存檔：漲價來回、壞資料修正（沒學會、超過上限、不是整數）', () => {
  const g = mk(13, (s) => learn(s, ['danbing', 'soymilk']));
  g.s.dishes.danbing.cooked = 250;
  g.setMarkup('danbing', 3);
  const back = RC.state.parse(RC.state.serialize(g.s));
  assert.deepEqual(back.markup, { danbing: 3 });
  const raw = JSON.parse(JSON.stringify(g.s));
  raw.markup = { danbing: 99, soymilk: 2.7, steak: 3, zzz: 1, bad: 'x' };
  const fixed = RC.state.normalize(raw);
  assert.equal(fixed.markup.danbing, D.MARKUP.max);
  assert.equal(fixed.markup.soymilk, 2);
  assert.equal(fixed.markup.steak, undefined);
  const old = JSON.parse(JSON.stringify(g.s));
  delete old.markup;
  assert.deepEqual(RC.state.normalize(old).markup, {});
});

test('長時間營運（20 道菜、套餐、進貨庫存、漲價）：庫存不為負、金幣有限、客人持續被服務', () => {
  const g = mk(14, (s) => {
    for (const d of D.dishList) s.dishes[d.id] = { cooked: 80 };
    s.level = 30;
    s.menu = ['danbing', 'soymilk', 'luroufan', 'boba', 'meatballsoup', 'cornsoup', 'tangyuan', 'fantuan', 'blacktea', 'chickenrice', 'friedrice', 'porkchop', 'burger', 'pasta', 'tiramisu', 'sandwich', 'coffee', 'carrotcake', 'toast', 'sausage'];
    s.stock = {};
    s.order = Object.fromEntries(s.menu.map((id) => [id, 15]));
    s.markup = { danbing: 2, luroufan: 3 };
    for (const [i, id] of ['stove_pro', 'stove_pro', 'stove_steam'].entries()) s.items.push({ uid: 50 + i, id, x: 6 + i, y: 0, rot: 0 });
    for (let i = 0; i < 3; i++) s.staff.push(RC.state.newStaff(10 + i, { name: 'x' + i, look: RC.state.makeLook(RC.util.makeRng(i)), speed: 1.2, skill: 1.2, wage: 0 }));
  }, { stock: true, dayMode: false });
  g.s.coins = 1e6;
  g.rebuild();
  g.syncCrew && g.syncCrew();
  let combos = 0;
  g.on('served', () => {});
  for (let t = 0; t < 1200; t += 0.1) {
    g.update(0.1);
    if (t % 60 < 0.1) g.deliver(); // 每分鐘進一次貨（不分日夜模式沒有時鐘）
    for (const c of g.customers) if (c.extra) combos++;
  }
  assert.ok(g.s.stats.served > 30, '服務了 ' + g.s.stats.served);
  assert.ok(combos > 0, '有套餐客人');
  for (const [id, n] of Object.entries(g.s.stock)) assert.ok(n >= 0 && Number.isFinite(n), `${id} 庫存 ${n}`);
  assert.ok(Number.isFinite(g.s.coins) && g.s.coins > 0);
  for (const c of g.customers) assert.ok(!c.dish || D.dishes[c.dish], '客人點的菜存在');
});
