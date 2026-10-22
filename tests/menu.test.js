'use strict';
// 100 道菜、每店 20 格菜單、爐灶門檻、進貨與庫存（每天 10 點到貨、冰箱容量）、成就
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;
const S = D.STOCK;

/** stock 預設開啟（測試載入器預設關閉，這裡明確開啟） */
function mk(seed = 1, mut, opts) {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  if (mut) mut(s);
  return new RC.Game(s, { seed, stock: true, ...opts });
}
const learnAll = (s) => {
  for (const d of D.dishList) s.dishes[d.id] = { cooked: 0 };
};
/** 跑到一天中的某個時刻（不營業，避免客人干擾） */
function toClock(g, minute) {
  g.setBusinessHours(1, 2);
  let guard = 0;
  while ((g.s.clock < minute || g.s.clock > minute + 30) && guard++ < 1e6) g.update(0.1);
  assert.ok(guard < 1e6);
}

/* ───────── 菜色資料 ───────── */

test('100 道菜：10 類各 10 道、id 不重複、價格成本爐灶都合理、舊的 14 道菜 id 還在', () => {
  assert.equal(D.dishList.length, 100);
  assert.equal(new Set(D.dishList.map((d) => d.id)).size, 100);
  for (const c of D.DISH_CATS) assert.equal(D.dishList.filter((d) => d.cat === c.id).length, 10, c.name);
  for (const id of ['danbing', 'soymilk', 'fantuan', 'luroufan', 'boba', 'xiaolongbao', 'chicken', 'beefnoodle', 'oyster', 'stinky', 'pineapple', 'hotpot', 'mangoice', 'buddha']) assert.ok(D.dishes[id], id);
  assert.equal(D.dishes.danbing.learn, 0);
  const stoveLv = { gas: 1, wok: 4, steam: 8, pro: 13 }; // 各等級爐灶開放買的等級
  for (const d of D.dishList) {
    assert.ok(D.dishCats[d.cat] && D.KIND_NAMES[d.kind], d.id);
    assert.ok(d.price > 0 && d.cost > 0 && d.cost < d.price, d.id);
    assert.ok(d.cook >= 3 && d.eat >= 3 && d.xp >= 1 && d.level >= 1 && d.level <= D.MAX_LEVEL, d.id);
    assert.ok(D.STOVE_TIERS.some((t) => t.id === d.stove), d.id);
    assert.ok(d.level >= stoveLv[d.stove], `${d.id} Lv${d.level} 需要 ${d.stove} 爐灶，解鎖等級不夠`);
  }
  // 爐灶家具的等級與菜色需求對得上
  assert.deepEqual(['stove_gas', 'stove_wok', 'stove_steam', 'stove_pro'].map((id) => D.furniture[id].tier), [0, 1, 2, 3]);
});

test('熟練度到 6 級（大師）：250 次', () => {
  assert.equal(D.MASTERY_MAX, 6);
  assert.equal(D.masteryLevel(249), 5);
  assert.equal(D.masteryLevel(250), 6);
  assert.equal(D.masteryLevel(99999), 6);
});

test('冰箱有三種等級，容量越來越大；烹飪時間加成最多 3 台生效', () => {
  const caps = ['fridge', 'fridge_big', 'freezer'].map((id) => D.furniture[id].cap);
  assert.ok(caps[0] < caps[1] && caps[1] < caps[2]);
  const g = mk(2, (s) => {
    s.items.push({ uid: 90, id: 'fridge', x: 7, y: 0, rot: 0 });
  });
  assert.equal(g.storageCap, S.base + D.furniture.fridge.cap);
  const g2 = mk(3, (s) => {
    s.items.push({ uid: 91, id: 'freezer', x: 7, y: 0, rot: 0 }, { uid: 92, id: 'fridge_big', x: 7, y: 1, rot: 0 });
  });
  assert.equal(g2.storageCap, S.base + D.furniture.freezer.cap + D.furniture.fridge_big.cap);
  const g3 = mk(4, (s) => {
    for (let i = 0; i < 5; i++) s.items.push({ uid: 100 + i, id: 'fridge', x: 7, y: i, rot: 0 });
  });
  assert.ok(Math.abs(g3.fridgeBonus - 0.18) < 1e-9);
});

/* ───────── 菜單 ───────── */

test('新遊戲：菜單只有蛋餅，有起始庫存與進貨量', () => {
  const g = mk(1);
  assert.deepEqual(g.s.menu, ['danbing']);
  assert.equal(g.s.stock.danbing, S.startQty);
  assert.equal(g.s.order.danbing, S.startQty);
});

test('上架／下架：只能上架學會的菜、最多 20 道、至少留一道', () => {
  const g = mk(2, (s) => {
    s.coins = 1e7;
    s.level = 50;
  });
  assert.equal(g.addMenu('steak').ok, false, '沒學會不能上架');
  for (const d of D.dishList.slice(0, 30)) g.s.dishes[d.id] = { cooked: 0 };
  let ok = 0;
  for (const d of D.dishList.slice(0, 30)) if (g.addMenu(d.id).ok) ok++;
  assert.equal(g.s.menu.length, S.menuMax);
  assert.equal(ok, S.menuMax - 1, '蛋餅本來就在菜單上');
  assert.equal(g.addMenu(D.dishList[29].id).ok, false);
  assert.equal(g.addMenu('danbing').ok, false, '已經上架');
  assert.equal(g.removeMenu('danbing').ok, true);
  assert.equal(g.s.menu.includes('danbing'), false);
  const solo = mk(3);
  assert.equal(solo.removeMenu('danbing').ok, false, '至少要有一道菜');
});

test('學會新菜：有空位自動上架、試做備料；菜單滿了不自動上架', () => {
  const g = mk(3, (s) => {
    s.coins = 1e7;
    s.level = 50;
  });
  assert.equal(g.learnDish('soymilk').ok, true);
  assert.ok(g.s.menu.includes('soymilk'));
  assert.equal(g.s.stock.soymilk, S.newDishQty);
  assert.ok(g.s.order.soymilk > 0);
  for (const d of D.dishList.slice(0, 25)) if (!g.s.dishes[d.id]) g.s.dishes[d.id] = { cooked: 0 };
  for (const d of D.dishList.slice(0, 25)) g.addMenu(d.id);
  assert.equal(g.s.menu.length, S.menuMax);
  assert.equal(g.learnDish('steak').ok, true);
  assert.equal(g.s.menu.includes('steak'), false);
});

test('舊存檔（沒有菜單）：學會的菜依等級自動上架（最多 20 道）並備一天的料；存檔來回、壞資料修正', () => {
  const g = mk(4, (s) => {
    s.level = 30;
    learnAll(s);
  });
  const raw = JSON.parse(JSON.stringify(g.s));
  for (const k of ['menu', 'order', 'stock', 'stockDay', 'ach']) delete raw[k];
  const old = RC.state.normalize(raw);
  assert.equal(old.menu.length, S.menuMax);
  const lv = old.menu.map((id) => D.dishes[id].level);
  assert.deepEqual(lv, [...lv].sort((a, b) => a - b), '低等級的先上架');
  for (const id of old.menu) assert.ok(old.order[id] > 0 && old.stock[id] > 0);
  // 來回
  g.addMenu('danbing');
  g.s.menu = ['soymilk', 'danbing'];
  g.s.order = { soymilk: 12, danbing: 7 };
  g.s.stock = { soymilk: 3 };
  g.s.stockDay = 5;
  g.s.ach = { learn10: true };
  const back = RC.state.parse(RC.state.serialize(g.s));
  assert.deepEqual(back.menu, ['soymilk', 'danbing']);
  assert.deepEqual(back.order, { soymilk: 12, danbing: 7 });
  assert.equal(back.stock.soymilk, 3);
  assert.equal(back.stockDay, 5);
  assert.deepEqual(back.ach, { learn10: true });
  // 壞資料：沒學會、重複、不存在的菜都丟掉
  const bad = JSON.parse(JSON.stringify(g.s));
  bad.dishes = { danbing: { cooked: 0 } };
  bad.menu = ['danbing', 'danbing', 'steak', 'nope', 5];
  bad.order = { danbing: -5, zzz: 4 };
  bad.ach = { nope: true, grand: true };
  const fixed = RC.state.normalize(bad);
  assert.deepEqual(fixed.menu, ['danbing']);
  assert.equal(fixed.order.danbing, 0);
  assert.equal(fixed.order.zzz, undefined);
  assert.deepEqual(fixed.ach, { grand: true });
});

/* ───────── 爐灶門檻 ───────── */

test('爐灶等級不夠就賣不了：菜單上煮不動的菜客人不會點', () => {
  const g = mk(5, (s) => {
    s.dishes.steak = { cooked: 0 };
    s.dishes.danbing = { cooked: 0 };
    s.menu = ['danbing', 'steak'];
    s.stock = { danbing: 5, steak: 5 };
  });
  assert.equal(g.maxStoveTier, 0);
  assert.equal(g.cookable('steak'), false);
  assert.equal(g.cookable('danbing'), true);
  assert.deepEqual(g.sellable(), ['danbing']);
  for (let i = 0; i < 200; i++) {
    g.s.stock.danbing = 5;
    assert.equal(g.pickOrder().dish, 'danbing');
  }
  // 換成專業爐台就煮得動了
  g.s.items.find((i) => i.id === 'stove_gas').id = 'stove_pro';
  g.rebuild();
  assert.equal(g.maxStoveTier, 3);
  assert.equal(g.cookable('steak'), true);
});

test('員工會挑等級夠的爐灶：高階菜不會用低階爐灶煮', () => {
  const g = mk(6, (s) => {
    s.dishes.steak = { cooked: 0 };
    s.items.push({ uid: 60, id: 'stove_pro', x: 6, y: 0, rot: 0 });
  });
  const pro = g.stoves.find((x) => x.id === 'stove_pro');
  const gas = g.stoves.find((x) => x.id === 'stove_gas');
  assert.ok(pro && gas);
  const boss = g.crew.find((m) => m.boss);
  const cust = { id: 999, state: 'wait_food', dish: 'steak' };
  g.customers.push(cust);
  boss.job = { cid: 999 };
  g.s.coins = 100;
  assert.equal(g.claimStove(boss), true);
  assert.equal(boss.stove, pro.uid, '牛排只能用專業爐台');
  g.stoveBusy.clear();
  g.stoveBusy.set(pro.uid, 'x'); // 專業爐台被占用：低階爐灶不能代勞
  boss.stove = null;
  assert.equal(g.claimStove(boss), false);
  void gas;
});

/* ───────── 庫存與進貨 ───────── */

test('點餐扣庫存；賣完的菜不再被點、全部賣完客人就不上門', () => {
  const g = mk(7, (s) => {
    s.stock = { danbing: 2 };
  });
  assert.equal(g.pickOrder().dish, 'danbing');
  assert.equal(g.pickOrder().dish, 'danbing');
  assert.equal(g.s.stock.danbing, 0);
  assert.equal(g.pickOrder(), null);
  assert.equal(g.canOpenDoor(), false, '菜都賣完了，客人不會上門');
  g.s.stock.danbing = 1;
  assert.equal(g.canOpenDoor(), true);
});

test('坐下後想點的菜剛好賣完：客人離開（算走掉、不算差評）', () => {
  const g = mk(8, (s) => {
    s.stock = { danbing: 1 };
  }, { dayMode: false });
  g.spawnTimer = 0;
  g.update(0.1);
  assert.equal(g.s.stock.danbing, 1);
  g.s.stock.danbing = 0;
  const angry0 = g.s.stats.angry;
  for (let i = 0; i < 400; i++) g.update(0.1);
  assert.equal(g.s.stats.angry, angry0);
  assert.equal(g.customers.filter((c) => c.dish).length, 0);
});

test('每天 10 點到貨一次：付成本、庫存增加，同一天不會重複進貨', () => {
  const g = mk(9, (s) => {
    s.coins = 1000;
    s.stock = { danbing: 5 };
    s.order = { danbing: 20 };
    s.stockDay = 0;
  });
  const events = [];
  g.on('delivery', (e) => events.push(e));
  toClock(g, 9 * 60 + 40);
  assert.equal(events.length, 0, '10 點以前還沒到貨');
  toClock(g, 10 * 60 + 5);
  assert.equal(events.length, 1);
  assert.equal(g.s.stock.danbing, 25);
  assert.equal(g.s.coins, 1000 - 20 * D.dishes.danbing.cost);
  assert.equal(g.s.stockDay, g.s.day);
  toClock(g, 11 * 60);
  assert.equal(events.length, 1, '同一天只到貨一次');
  // 隔天 10 點再到貨
  const day = g.s.day;
  let guard = 0;
  while (g.s.day === day && guard++ < 1e6) g.update(0.1);
  toClock(g, 10 * 60 + 5);
  assert.equal(events.length, 2);
  assert.equal(g.s.stock.danbing, S.base, '倉庫只裝得下 40 份');
});

test('進貨受倉儲容量限制，超過的部分不進也不付錢；冰箱越大容量越大', () => {
  const g = mk(10, (s) => {
    s.coins = 1e6;
    s.stock = { danbing: S.base - 10 };
    s.order = { danbing: 100 };
  });
  g.deliver();
  assert.equal(g.stockTotal(), S.base, '只進了補滿容量的 10 份');
  assert.equal(g.s.coins, 1e6 - 10 * D.dishes.danbing.cost);
  const big = mk(11, (s) => {
    s.coins = 1e6;
    s.stock = {};
    s.order = { danbing: 500 };
    s.items.push({ uid: 70, id: 'freezer', x: 7, y: 0, rot: 0 });
  });
  big.deliver();
  assert.equal(big.s.stock.danbing, S.base + D.furniture.freezer.cap);
});

test('金幣不夠：買得起多少進多少；全部沒貨又買不起時，供應商賒帳補最便宜的菜', () => {
  const g = mk(12, (s) => {
    s.dishes.soymilk = { cooked: 0 };
    s.menu = ['danbing', 'soymilk'];
    s.coins = 3 * D.dishes.danbing.cost + 1;
    s.stock = {};
    s.order = { danbing: 50, soymilk: 50 };
  });
  g.deliver();
  assert.equal(g.s.stock.danbing, 3);
  assert.ok(g.s.coins >= 0);
  const broke = mk(13, (s) => {
    s.dishes.soymilk = { cooked: 0 };
    s.menu = ['danbing', 'soymilk'];
    s.coins = 0;
    s.stock = {};
    s.order = { danbing: 50, soymilk: 50 };
  });
  let credit = 0;
  broke.on('delivery', (e) => (credit = e.credit));
  broke.deliver();
  assert.equal(credit, S.creditQty);
  assert.equal(broke.s.coins, 0);
  const cheap = ['danbing', 'soymilk'].sort((a, b) => D.dishes[a].cost - D.dishes[b].cost)[0];
  assert.equal(broke.s.stock[cheap], S.creditQty);
  assert.ok(broke.sellable().length > 0, '不會卡死');
});

test('進貨量：0～999、只能設上架的菜；自動分配依等級；午夜結算帶進貨花費', () => {
  const g = mk(14, (s) => {
    s.level = 20;
    s.dishes.soymilk = { cooked: 0 };
    s.dishes.boba = { cooked: 0 };
    s.menu = ['danbing', 'soymilk'];
  });
  assert.equal(g.setOrder('danbing', 1000).ok, false);
  assert.equal(g.setOrder('danbing', -1).ok, false);
  assert.equal(g.setOrder('boba', 5).ok, false, '沒上架');
  assert.equal(g.setOrder('danbing', 12).ok, true);
  assert.equal(g.s.order.danbing, 12);
  assert.equal(g.autoOrder().ok, true);
  assert.equal(g.s.order.danbing, RC.state.defaultOrderQty(2, 20));
  // 午夜結算事件含 procure
  const h = mk(15, (s) => {
    s.coins = 1000;
    s.stock = {};
    s.order = { danbing: 10 };
  });
  let ev = null;
  h.on('newday', (e) => (ev = e));
  h.setBusinessHours(1, 2);
  let guard = 0;
  const day = h.s.day;
  while (h.s.day === day && guard++ < 1e6) h.update(0.1);
  assert.equal(ev.procure, 10 * D.dishes.danbing.cost);
});

test('分店開幕：只有瓦斯爐，先上架煮得動的菜並備一天的料', () => {
  const s = RC.state.newGame(RC.util.makeRng(16));
  s.level = 30;
  learnAll(s);
  const st = RC.state.newStore(1, '東區店', [], RC.util.makeRng(1));
  RC.state.attach(st, RC.state.link ? s.company : s.company);
  RC.state.seedMenu(st, st.dishes, st.level, true, 0);
  assert.ok(st.menu.length > 0 && st.menu.length <= S.menuMax);
  for (const id of st.menu) {
    assert.equal(D.dishes[id].stove, 'gas', id);
    assert.ok(st.stock[id] > 0 && st.order[id] > 0);
  }
});

/* ───────── 成就 ───────── */

test('成就：學會菜色達標發獎金；只領一次；存檔保留', () => {
  const g = mk(17, (s) => {
    s.coins = 1e9;
    s.level = 50;
  });
  const got = [];
  g.on('achievement', (a) => got.push(a.id));
  let coins = g.s.coins;
  for (const d of D.dishList.slice(0, 9)) g.s.dishes[d.id] = { cooked: 0 };
  g.checkAchievements();
  assert.deepEqual(got, [], '9 道還不夠');
  g.s.dishes[D.dishList[9].id] = { cooked: 0 };
  g.checkAchievements();
  assert.ok(got.includes('learn10'));
  assert.equal(g.s.coins, coins + D.achievements.learn10.reward);
  coins = g.s.coins;
  g.checkAchievements();
  assert.equal(g.s.coins, coins, '不重複發獎');
  const back = RC.state.parse(RC.state.serialize(g.s));
  assert.equal(back.ach.learn10, true);
});

test('成就：類別精通有永久加成（該類售價 +5%）；烹飪次數達標也會觸發', () => {
  const g = mk(18, (s) => {
    s.coins = 1e9;
    s.level = 50;
  });
  const base = g.dishInfo('danbing').price;
  for (const d of D.dishList.filter((x) => x.cat === 'breakfast')) g.s.dishes[d.id] = { cooked: 25 };
  g.checkAchievements();
  assert.equal(g.s.ach.catmaster_breakfast, true);
  assert.equal(g.s.ach.catlearn_breakfast, true);
  const info = g.dishInfo('danbing');
  const m3 = 1 + 0.08 * 2;
  assert.equal(info.price, Math.round(D.dishes.danbing.price * m3 * (1 + 0.1 * g.stars) * 1.05));
  assert.ok(info.price >= base);
  const other = g.dishInfo('boba');
  assert.equal(other.price, Math.round(D.dishes.boba.price * (1 + 0.1 * g.stars)), '別的類別不受影響');
  // 烹飪次數
  g.s.dishes.danbing.cooked = 99;
  g.s.dishes.danbing.cooked++;
  g.checkAchievements();
  assert.equal(g.s.ach.cook100, true);
});

test('百味宗師：100 道全部大師 → 全部售價 +10%、烹飪時間 −5%', () => {
  const g = mk(19, (s) => {
    s.level = 50;
    for (const d of D.dishList) s.dishes[d.id] = { cooked: 250 };
    s.dishes.danbing.cooked = 2000;
  });
  g.checkAchievements();
  assert.equal(g.s.ach.grand, true);
  assert.equal(g.s.ach.master50, true);
  const p = g.achPerks();
  assert.ok(p.price >= 0.1 - 1e-9 && Math.abs(p.cook - 0.05) < 1e-9);
  assert.ok(Object.keys(g.s.ach).length === D.ACHIEVEMENTS.length, '全部成就達成');
});
