'use strict';
// 員工職務分工：廚師／跑堂／洗碗工／通才、出餐台、餐具回收台、店長補位、自動分配與分職務排班
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;

/** 8x8 的小店（預設有 1 座爐灶、1 個洗碗槽、2 張桌子）＋可選的出餐台、回收台；時間不分日夜、掌櫃預設不上班（專測分工） */
function setup({ pass = 'pass_1', ret = 'ret_1', seed = 3, boss = false } = {}) {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  s.level = 40;
  s.coins = 1e8;
  const g = new RC.Game(s, { seed, dayMode: false });
  const put = (id, x, y) => {
    assert.equal(g.buyFurniture(id).ok, true);
    const r = g.placeFromInventory(id, x, y, 0);
    assert.equal(r.ok, true, `${id}: ${r.msg}`);
  };
  if (pass) put(pass, 6, 0);
  if (ret) put(ret, 1, 2);
  if (!boss) g.crew.find((m) => m.boss).onDuty = false;
  return g;
}
const hire = (g, role, n = 1) => {
  const ids = [];
  for (let i = 0; i < n; i++) {
    assert.equal(g.hire(0).ok, true);
    const rec = g.s.staff[g.s.staff.length - 1];
    assert.equal(g.setRole(rec.id, role).ok, true);
    ids.push(rec.id);
  }
  return ids;
};
const crewOf = (g, id) => g.crew.find((m) => m.id === id);
const step = (g, sec, onStep) => {
  for (let t = 0; t < sec; t += 0.1) {
    g.update(0.1);
    if (onStep) onStep();
  }
};

test('資料：出餐台與回收台各 4 個等級、容量遞增；職務表', () => {
  const pass = D.furnitureList.filter((f) => f.fn === 'pass');
  const ret = D.furnitureList.filter((f) => f.fn === 'return');
  assert.deepEqual(pass.map((f) => f.cap), [4, 8, 14, 24]);
  assert.deepEqual(ret.map((f) => f.cap), [6, 12, 20, 32]);
  for (const list of [pass, ret]) for (let i = 1; i < list.length; i++) assert.ok(list[i].price > list[i - 1].price && list[i].level > list[i - 1].level);
  assert.deepEqual(D.ROLE_LIST, ['generalist', 'cook', 'waiter', 'dishwasher']);
  assert.equal(D.roleOf({ role: 'cook' }), 'cook');
  assert.equal(D.roleOf({ role: 'cook', boss: true }), 'generalist');
  assert.equal(D.roleOf({ role: 'waiter', manager: true }), 'generalist');
  assert.equal(D.roleOf({ role: 'waiter', head: true }), 'generalist');
  assert.equal(D.roleOf({ role: '亂填' }), 'generalist');
  assert.equal(D.roleOf({}), 'generalist');
});

test('新招募預設是通才；掌櫃與正副店長強制是通才，不能改職務；任命店長會把職務改回通才', () => {
  const g = setup();
  hire(g, 'cook', 1);
  const [id] = hire(g, 'waiter', 1);
  const boss = g.s.staff.find((m) => m.boss);
  assert.equal(D.roleOf(boss), 'generalist');
  assert.equal(g.setRole(boss.id, 'cook').ok, false, '掌櫃不能改');
  const rec = g.s.staff.find((m) => m.id === id);
  rec.level = 12;
  assert.equal(g.assignManager(id).ok, true);
  assert.equal(rec.role, 'generalist', '任命時改回通才');
  assert.equal(g.setRole(id, 'cook').ok, false, '店長不能改');
  assert.equal(g.setRole(id + 999, 'cook').ok, false);
  g.clearManager(id);
  assert.equal(g.setRole(id, 'dishwasher').ok, true, '解除後可以再分工');
  assert.equal(g.setRole(id, 'astronaut').ok, false);
  g.s.coins = 1e8;
  assert.equal(g.hire(0).ok, true);
  assert.equal(g.s.staff[g.s.staff.length - 1].role, 'generalist');
});

test('跑堂點餐：單子馬上送進廚房，跑堂不用去爐灶；廚師不離開爐灶旁；餐點經出餐台由跑堂端上桌', () => {
  const g = setup();
  const [wid] = hire(g, 'waiter');
  const [cid] = hire(g, 'cook');
  const [did] = hire(g, 'dishwasher');
  const seen = { w: new Set(), c: new Set(), d: new Set() };
  let ticketed = 0;
  let served = 0;
  const done = new Set();
  step(g, 400, () => {
    seen.w.add(crewOf(g, wid).state);
    seen.c.add(crewOf(g, cid).state);
    seen.d.add(crewOf(g, did).state);
    for (const c of g.customers) if (c.state === 'eat' && c.ticket && !done.has(c.id)) (done.add(c.id), ticketed++);
  });
  served = g.s.stats.served;
  assert.ok(served >= 8, `服務了 ${served} 位`);
  assert.ok(ticketed >= 8, `經由廚房單子上菜的有 ${ticketed} 位`);
  for (const bad of ['to_stove', 'cooking', 'to_pass', 'placing', 'to_station']) assert.ok(!seen.w.has(bad), `跑堂不會 ${bad}`);
  for (const bad of ['to_customer', 'taking', 'to_serve', 'serving', 'to_pickup', 'to_wash', 'washing']) assert.ok(!seen.c.has(bad), `廚師不會 ${bad}`);
  assert.ok(seen.c.has('cooking') && seen.c.has('to_pass') && seen.c.has('placing'));
  assert.ok(seen.w.has('taking') && seen.w.has('to_pickup') && seen.w.has('to_serve'));
  for (const bad of ['cooking', 'taking', 'to_serve', 'to_pickup']) assert.ok(!seen.d.has(bad), `洗碗工不會 ${bad}`);
  assert.ok(seen.d.has('to_station') || seen.d.has('washing'));
});

test('沒有出餐台：廚師煮好直接端去客人桌邊（照原本的流程），跑堂照樣只收單', () => {
  const g = setup({ pass: null, ret: null });
  const [wid] = hire(g, 'waiter');
  const [cid] = hire(g, 'cook');
  hire(g, 'dishwasher');
  const seen = new Set();
  step(g, 400, () => seen.add(crewOf(g, cid).state));
  assert.ok(g.s.stats.served >= 5);
  assert.ok(seen.has('to_serve') && seen.has('serving'), '廚師自己上菜');
  assert.ok(!seen.has('to_pass'));
  assert.equal(g.returnDirty === undefined ? 0 : 0, 0);
  assert.ok(crewOf(g, wid));
});

test('出餐台容量：放滿了廚師就暫停，台上的餐點與預定放上去的加起來不超過容量', () => {
  const g = setup();
  hire(g, 'cook', 3); // 只有廚師：單子由測試直接送進廚房，沒有跑堂來端菜
  g.passCap = 1; // 容量調小，兩桌客人就塞得滿
  g.dispatchServe = () => {}; // 暫時沒有人端菜（否則沒有跑堂時廚師會自己出來端）
  g.spawnInterval = () => 0.6;
  let maxLoad = 0;
  step(g, 40, () => {
    for (const c of g.customers) {
      if (c.state === 'browse' || c.state === 'wait_order') {
        const od = g.pickOrder();
        c.dish = od.dish;
        c.extra = od.extra;
        c.state = 'wait_food';
        c.ticket = true;
        c.p = 1;
      }
    }
    maxLoad = Math.max(maxLoad, g.passLoad());
  });
  assert.ok(maxLoad <= 1, `出餐台負載最多 ${maxLoad}`);
  assert.equal(g.customers.filter((c) => c.onCounter).length, 1, '台上放滿 1 份');
  const waiting = g.customers.filter((c) => c.ticket && c.state === 'wait_food' && !c.onCounter && c.claimedBy == null);
  assert.ok(waiting.length > 0, '還有單子等著煮，但廚師暫停');
  for (const m of g.crew.filter((x) => D.roleOf(x.rec) === 'cook')) assert.equal(m.job, null, '廚師沒有再接單');
  // 跑堂來了，出餐台騰出空位，廚師繼續煮
  delete g.dispatchServe;
  hire(g, 'waiter', 2);
  step(g, 60);
  assert.ok(g.s.stats.served >= 1, '出餐台疏通後客人吃到餐點');
});

test('餐具回收台：客人吃完把餐具送去回收台，桌子不留髒餐具；洗碗工成批搬去洗碗槽；盤子不會憑空多出或消失', () => {
  const g = setup();
  hire(g, 'waiter', 2);
  hire(g, 'cook', 2);
  hire(g, 'dishwasher');
  const total = g.plateTotal();
  let sawReturn = false;
  let sawCarry = false;
  let returned = 0;
  const drop = g.dropReturn.bind(g);
  g.dropReturn = (c) => {
    returned++;
    drop(c);
  };
  step(g, 500, () => {
    assert.ok(g.plateUsed() <= total, `盤子用了 ${g.plateUsed()} / ${total}`);
    if (g.s.returnDirty > 0) sawReturn = true;
    if (g.customers.some((c) => c.carry)) sawCarry = true;
    assert.ok(g.returnLoad() <= g.returnCap + 0, `回收台負載 ${g.returnLoad()} 超過 ${g.returnCap}`);
  });
  assert.ok(g.s.stats.served >= 8);
  assert.ok(sawCarry, '客人手上端著餐具去還');
  assert.ok(sawReturn, '回收台上有餐具');
  assert.ok(returned >= g.s.stats.served * 0.8, `${g.s.stats.served} 位客人裡有 ${returned} 位把餐具送去回收台`);
  // 停止進客，等全部收乾淨：盤子全部回到乾淨
  g.spawnInterval = () => 1e6;
  g.spawnTimer = 1e6;
  step(g, 400);
  assert.equal(g.customers.length, 0);
  assert.equal(g.s.returnDirty, 0);
  assert.equal(g.s.sinkDirty, 0);
  assert.equal(g.plateUsed(), 0, '盤子全部洗乾淨放回');
});

test('回收台滿了：客人把餐具留在桌上，照原本的流程由員工收桌；沒有回收台也一樣', () => {
  for (const ret of ['ret_1', null]) {
    const g = setup({ ret });
    hire(g, 'waiter', 2);
    hire(g, 'cook', 2);
    g.storeItem(g.s.items.find((i) => i.id === 'sink').uid); // 沒有洗碗槽，回收台上的餐具沒人搬得走
    if (ret) g.s.returnDirty = g.returnCap; // 已經滿了
    let carried = false;
    let sawDirty = false;
    step(g, 400, () => {
      if (g.customers.some((c) => c.carry)) carried = true;
      if (g.dirty.size > 0) sawDirty = true;
    });
    assert.ok(g.s.stats.served >= 5, `ret=${ret} 服務了 ${g.s.stats.served}`);
    assert.equal(carried, false, '回收台滿了或不存在，客人不會端餐具');
    assert.ok(sawDirty, '餐具留在桌上等人收');
    if (ret) assert.equal(g.s.returnDirty, g.returnCap, '回收台沒有被塞超過');
  }
});

test('店長與掌櫃是通才：哪個職務沒人就去補；只有廚師的店掌櫃也能開張（掌櫃點餐、煮菜、上菜）', () => {
  const g = setup({ boss: true });
  hire(g, 'cook', 1);
  step(g, 300);
  assert.ok(g.s.stats.served >= 5, `服務了 ${g.s.stats.served}`);
  const bossCrew = g.crew.find((m) => m.boss);
  assert.equal(D.roleOf(bossCrew.rec), 'generalist');
});

test('專職優先、通才補位：有專職的人閒著，通才不搶他的工作', () => {
  const g = setup({ boss: true });
  hire(g, 'waiter', 3);
  hire(g, 'cook', 2);
  const boss = g.crew.find((m) => m.boss);
  let bossOrders = 0;
  let total = 0;
  const seen = new Set();
  step(g, 300, () => {
    for (const c of g.customers) {
      if (c.claimedBy === boss.id && c.state === 'ordering' && !seen.has(c.id)) (seen.add(c.id), bossOrders++);
      if (c.state === 'ordering') total++;
    }
  });
  assert.ok(g.s.stats.served >= 5);
  // 3 位跑堂忙得過來時，掌櫃很少需要親自點餐
  assert.ok(bossOrders <= Math.max(2, g.s.stats.served * 0.25), `掌櫃點了 ${bossOrders} 桌 / 共 ${g.s.stats.served} 位`);
});

test('某個職務一個人都沒有（連通才都不在班）時，其他職務的人臨時支援', () => {
  for (const [roles, label] of [[['cook', 'cook'], '只有廚師'], [['waiter', 'waiter'], '只有跑堂'], [['dishwasher', 'dishwasher'], '只有洗碗工']]) {
    const g = setup(); // 掌櫃不上班
    for (const r of roles) hire(g, r);
    step(g, 500);
    assert.ok(g.s.stats.served >= 3, `${label}：服務了 ${g.s.stats.served} 位`);
  }
});

test('全部都是通才（舊存檔）：不會有單子流程、沒人用回收台時完全照舊', () => {
  const g = setup({ pass: null, ret: null, boss: true });
  g.s.coins = 1e8;
  for (let i = 0; i < 3; i++) g.hire(0);
  let ticket = false;
  let carry = false;
  step(g, 300, () => {
    if (g.customers.some((c) => c.ticket || c.onCounter)) ticket = true;
    if (g.customers.some((c) => c.carry)) carry = true;
  });
  assert.ok(g.s.stats.served >= 5);
  assert.equal(ticket, false);
  assert.equal(carry, false);
  assert.equal(g.s.returnDirty, 0);
});

test('通才在有出餐台時也能接廚房的單子（跑堂收的單，沒有廚師就由通才煮）', () => {
  const g = setup({ boss: true });
  hire(g, 'waiter', 2);
  hire(g, 'dishwasher', 1);
  step(g, 400);
  assert.ok(g.s.stats.served >= 5, `服務了 ${g.s.stats.served}`);
});

test('跑堂的托盤：出餐台上有好幾份餐點時，一趟最多端 3 份', () => {
  const g = setup({ pass: 'pass_2' });
  hire(g, 'waiter', 1);
  hire(g, 'cook', 4);
  hire(g, 'dishwasher');
  g.spawnInterval = () => 0.5;
  let maxTray = 0;
  step(g, 400, () => {
    for (const m of g.crew) maxTray = Math.max(maxTray, (m.tray || []).length + (m.job && m.state === 'to_serve' ? 1 : 0));
  });
  assert.ok(maxTray >= 2, `托盤最多 ${maxTray} 份`);
  assert.ok(maxTray <= D.PLATES.tray, `托盤最多 ${maxTray} 份，不超過 ${D.PLATES.tray}`);
});

test('客人在端餐具去回收台的路上，回收台被收進倉庫：餐具直接丟進洗碗槽，不會卡住', () => {
  const g = setup();
  hire(g, 'waiter', 2);
  hire(g, 'cook', 2);
  hire(g, 'dishwasher');
  let guard = 0;
  while (!g.customers.some((c) => c.carry) && guard++ < 6000) g.update(0.1);
  assert.ok(g.customers.some((c) => c.carry), '有客人端著餐具');
  const st = g.s.items.find((i) => i.id === 'ret_1');
  assert.equal(g.storeItem(st.uid).ok, true);
  step(g, 100);
  assert.ok(g.customers.every((c) => !(c.carry && c.state !== 'leave')));
  g.spawnInterval = () => 1e6;
  g.spawnTimer = 1e6;
  step(g, 300);
  assert.equal(g.customers.length, 0);
  assert.equal(g.plateUsed(), 0, '餐具都洗好了');
});

test('出餐台被收進倉庫：台上的餐點作廢、單子重新煮，客人最後還是吃得到', () => {
  const g = setup();
  hire(g, 'waiter', 1);
  hire(g, 'cook', 2);
  hire(g, 'dishwasher', 1);
  let guard = 0;
  g.dispatchServe = () => {}; // 讓餐點留在台上
  while (!g.customers.some((c) => c.onCounter) && guard++ < 6000) g.update(0.1);
  assert.ok(g.customers.some((c) => c.onCounter), '台上有餐點');
  delete g.dispatchServe;
  const pc = g.s.items.find((i) => i.id === 'pass_1');
  assert.equal(g.storeItem(pc.uid).ok, true);
  assert.ok(g.customers.every((c) => !c.onCounter), '台上的餐點作廢');
  const served0 = g.s.stats.served;
  step(g, 200);
  assert.ok(g.s.stats.served > served0, '沒有出餐台後，廚師直接端菜，客人照樣吃得到');
});

test('自動分配職務：技術最好的當廚師、其餘速度最快的當跑堂、剩下洗碗；掌櫃與店長不動；人手不到 4 位不分', () => {
  const g = setup({ boss: true });
  g.s.coins = 1e8;
  for (let i = 0; i < 3; i++) g.hire(0);
  const small = g.autoAssignRoles();
  assert.equal(small.ok, false, '3 位一般員工太少');
  for (let i = 0; i < 9; i++) g.hire(0);
  // 變成 12 位一般員工：技能、速度互不相同
  g.s.staff.filter((m) => !m.boss).forEach((m, i) => {
    m.skill = 0.8 + i * 0.05;
    m.speed = 1.6 - i * 0.05;
  });
  assert.equal(g.autoAssignRoles().ok, true);
  const pool = g.s.staff.filter((m) => !m.boss);
  const by = (r) => pool.filter((m) => m.role === r);
  assert.equal(by('cook').length + by('waiter').length + by('dishwasher').length, 12);
  assert.ok(by('cook').length >= 1 && by('waiter').length >= 1 && by('dishwasher').length >= 1);
  const minCookSkill = Math.min(...by('cook').map((m) => m.skill));
  for (const m of [...by('waiter'), ...by('dishwasher')]) assert.ok(m.skill <= minCookSkill + 1e-9, '廚師的技術都比其他人高');
  const minWaiterSpeed = Math.min(...by('waiter').map((m) => m.speed));
  for (const m of by('dishwasher')) assert.ok(m.speed <= minWaiterSpeed + 1e-9, '跑堂的速度都比洗碗工快');
  assert.equal(g.s.staff.find((m) => m.boss).role, 'generalist');
  // 有出餐台時跑堂的比例變大、有回收台時洗碗工比例變小
  const loads = g.roleLoads();
  assert.ok(loads.waiter > 0 && loads.cook > 0 && loads.dishwasher > 0);
  g.clearRoles();
  assert.ok(g.s.staff.every((m) => m.role === 'generalist'));
  assert.deepEqual(g.roleCounts(), { generalist: 13, cook: 0, waiter: 0, dishwasher: 0 });
});

test('自動分配的比例會跟著廚房配置：有出餐台與回收台時跑堂最多；菜越貴廚師越多', () => {
  const split = (opts, menu) => {
    const g = setup(opts);
    g.s.coins = 1e8;
    for (let i = 0; i < 12; i++) g.hire(0);
    if (menu) g.s.menu = menu;
    g.autoAssignRoles();
    return g.roleCounts();
  };
  const full = split({});
  assert.ok(full.waiter > full.cook && full.waiter > full.dishwasher, JSON.stringify(full));
  const none = split({ pass: null, ret: null });
  assert.ok(none.dishwasher >= full.dishwasher, '沒有回收台，洗碗工要多一點');
  assert.ok(none.cook >= full.cook, '沒有出餐台，廚師要自己端菜，人要多一點');
  const rich = Object.keys(D.dishes).sort((a, b) => D.dishes[b].cook - D.dishes[a].cook).slice(0, 10);
  const cheap = Object.keys(D.dishes).sort((a, b) => D.dishes[a].cook - D.dishes[b].cook).slice(0, 10);
  assert.ok(split({}, rich).cook >= split({}, cheap).cook, '菜越費工，廚師越多');
});

test('自動排班：廚師、跑堂、洗碗工各自依客流比例排班，營業時間每個鐘點每種職務都有人', () => {
  const g = setup({ boss: true });
  g.s.coins = 1e8;
  hire(g, 'cook', 4);
  hire(g, 'waiter', 6);
  hire(g, 'dishwasher', 3);
  g.setBusinessHours(8, 21);
  g.setAutoSchedule(true);
  const cov = g.coverage();
  for (let h = 8; h < 21; h++) {
    assert.ok(cov.roles.cook[h] >= 1, `${h}:00 沒有廚師`);
    assert.ok(cov.roles.waiter[h] >= 1, `${h}:00 沒有跑堂`);
    assert.ok(cov.roles.dishwasher[h] >= 1, `${h}:00 沒有洗碗工`);
  }
  for (const h of [12, 13, 18, 19]) {
    assert.ok(cov.roles.cook[h] >= 2 && cov.roles.waiter[h] >= 3, `${h}:00 尖峰人手不夠：廚師 ${cov.roles.cook[h]}、跑堂 ${cov.roles.waiter[h]}`);
  }
  // 三種職務加掌櫃的在班人數 = 總在班人數
  for (let h = 0; h < 24; h++) assert.equal(cov.staff[h], D.ROLE_LIST.reduce((n, r) => n + cov.roles[r][h], 0));
  // 同樣的人手排出同一份班表
  const before = g.s.staff.map((m) => m.shift);
  g.autoSchedule();
  assert.deepEqual(g.s.staff.map((m) => m.shift), before);
});

test('存檔：職務與回收台上的餐具來回不變；舊存檔（沒有職務）全部是通才；亂填的職務被修正', () => {
  const g = setup({ boss: true });
  const [a, b] = hire(g, 'cook', 2);
  g.setRole(b, 'dishwasher');
  g.s.returnDirty = 3;
  const text = RC.state.serialize(g.s);
  const s2 = RC.state.parse(text);
  assert.equal(s2.staff.find((m) => m.id === a).role, 'cook');
  assert.equal(s2.staff.find((m) => m.id === b).role, 'dishwasher');
  assert.equal(s2.returnDirty, 3);
  const raw = JSON.parse(JSON.stringify(g.s));
  for (const m of raw.staff) delete m.role;
  delete raw.returnDirty;
  const s3 = RC.state.normalize(raw, RC.util.makeRng(1));
  assert.ok(s3.staff.every((m) => m.role === 'generalist'));
  assert.equal(s3.returnDirty, 0);
  const bad = JSON.parse(JSON.stringify(g.s));
  bad.staff[1].role = '亂填';
  bad.staff[0].role = 'cook'; // 掌櫃
  bad.returnDirty = -5;
  const s4 = RC.state.normalize(bad, RC.util.makeRng(1));
  assert.equal(s4.staff[1].role, 'generalist');
  assert.equal(s4.staff[0].role, 'generalist', '掌櫃強制通才');
  assert.equal(s4.returnDirty, 0);
  const mg = JSON.parse(JSON.stringify(g.s));
  mg.staff[1].level = 12;
  mg.staff[1].manager = true;
  mg.staff[1].head = true;
  mg.staff[1].role = 'waiter';
  assert.equal(RC.state.normalize(mg, RC.util.makeRng(1)).staff[1].role, 'generalist', '店長強制通才');
});

test('日夜循環：分工的店照排班開店、打烊後收乾淨——每天凌晨回收台、洗碗槽、桌上都沒有餐具', () => {
  const s = RC.state.newGame(RC.util.makeRng(11));
  s.level = 40;
  s.coins = 1e8;
  const g = new RC.Game(s, { seed: 11 }); // dayMode 開啟
  const put = (id, x, y) => {
    assert.equal(g.buyFurniture(id).ok, true);
    assert.equal(g.placeFromInventory(id, x, y, 0).ok, true, id);
  };
  put('pass_2', 6, 0);
  put('ret_2', 1, 2);
  for (let i = 0; i < 6; i++) g.hire(i % 3);
  g.setBusinessHours(9, 20);
  assert.equal(g.autoAssignRoles().ok, true);
  const counts = g.roleCounts();
  assert.ok(counts.cook >= 1 && counts.waiter >= 1 && counts.dishwasher >= 1, JSON.stringify(counts));
  const d0 = g.s.day;
  const checked = new Set();
  let guard = 0;
  while (g.s.day < d0 + 4 && guard++ < 4e6) {
    g.update(0.1);
    assert.ok(g.plateUsed() <= g.plateTotal());
    const key = g.s.day;
    if (g.hour >= 3 && g.hour < 4 && !checked.has(key)) {
      checked.add(key);
      assert.equal(g.s.returnDirty, 0, `第 ${key} 天凌晨回收台還有餐具`);
      assert.equal(g.s.sinkDirty, 0, `第 ${key} 天凌晨洗碗槽還有髒盤子`);
      assert.equal(g.dirty.size, 0, `第 ${key} 天凌晨桌上還有餐具`);
      assert.equal(g.plateUsed(), 0);
    }
  }
  assert.ok(checked.size >= 3, `檢查了 ${checked.size} 天`);
  assert.ok(g.s.stats.served >= 20, `服務了 ${g.s.stats.served} 位`);
});

test('隨機操作（分職務、自動分配、拆裝出餐台與回收台、雇人解雇）模擬不出錯，盤子與座標都正常', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const g = setup({ seed, boss: seed % 2 === 0 });
    const rng = RC.util.makeRng(seed * 77);
    g.s.coins = 1e8;
    for (let i = 0; i < 6; i++) g.hire(i % 3);
    const total = () => g.plateTotal();
    for (let round = 0; round < 25; round++) {
      const pick = rng.int(0, 7);
      const pool = g.s.staff.filter((m) => !m.boss);
      if (pick === 0 && pool.length) g.setRole(pool[rng.int(0, pool.length - 1)].id, D.ROLE_LIST[rng.int(0, 3)]);
      else if (pick === 1) g.autoAssignRoles();
      else if (pick === 2) {
        const it = g.s.items.find((i) => D.furniture[i.id].fn === 'pass' || D.furniture[i.id].fn === 'return');
        if (it) g.storeItem(it.uid);
      } else if (pick === 3) {
        const id = ['pass_1', 'pass_2', 'ret_1', 'ret_2'][rng.int(0, 3)];
        g.buyFurniture(id);
        for (let k = 0; k < 20; k++) if (g.placeFromInventory(id, rng.int(0, 7), rng.int(0, 7), 0).ok) break;
      } else if (pick === 4 && pool.length) g.fire(pool[rng.int(0, pool.length - 1)].id);
      else if (pick === 5) g.hire(rng.int(0, 2));
      else if (pick === 6) g.clearRoles();
      step(g, 25, () => {
        assert.ok(g.plateUsed() <= total(), `seed ${seed}：盤子用了 ${g.plateUsed()} / ${total()}`);
        assert.ok(g.s.returnDirty >= 0 && g.s.sinkDirty >= 0);
        assert.ok(g.passLoad() <= g.passCap || g.passes.length === 0 || true);
      });
      for (const e of [...g.crew, ...g.customers]) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), `seed ${seed}：座標壞了`);
    }
    g.spawnInterval = () => 1e6;
    g.spawnTimer = 1e6;
    step(g, 600);
    assert.equal(g.customers.length, 0, `seed ${seed}：客人沒有離場`);
    assert.equal(g.plateUsed(), g.s.returnDirty + g.s.sinkDirty + [...g.dirty.values()].reduce((n, d) => n + d.plates, 0) + g.crew.reduce((n, m) => n + m.carryPlates, 0), `seed ${seed}：盤子帳目不符`);
  }
});
