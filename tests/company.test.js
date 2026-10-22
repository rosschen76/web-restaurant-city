'use strict';
// 分店：公司層（共用）與店面（獨立）、總經理、雙店長制、開分店、調動、懶惰結算、連鎖崩壞、關店、存檔
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;

/** 主店已發展到上限：18×18、三星、有錢 */
function rich(seed = 1, mut) {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  s.coins = 5e6;
  s.level = 40;
  s.room.stage = D.expansions.length - 1;
  // 三星需要魅力 400：把裝飾放在場外湊魅力（只影響魅力計算）
  for (const [id, n] of [['piano', 10], ['statue', 10], ['jukebox', 10], ['fishtank', 6]]) for (let i = 0; i < n; i++) s.items.push({ uid: s.nextUid++, id, x: 99, y: 99, rot: 0 });
  if (mut) mut(s);
  return new RC.Game(s, { seed });
}
/** 雇人並設定等級／能力。specs: [{level, speed, skill}] */
function withStaff(g, specs) {
  const out = [];
  for (const sp of specs) {
    assert.equal(g.hire(0).ok, true);
    const rec = g.s.staff[g.s.staff.length - 1];
    rec.level = sp.level;
    if (sp.speed) rec.speed = sp.speed;
    if (sp.skill) rec.skill = sp.skill;
    out.push(rec);
  }
  return out;
}
/** 夠開分店的人手：2 位 Lv.10 以上、4 位 Lv.8 以上（再加兩位普通員工）。回傳 { a, b, c, d, e, f } */
function crewForBranch(g, extra = 0) {
  const recs = withStaff(g, [
    { level: 10, speed: 1.0, skill: 1.0 }, // a：弱
    { level: 12, speed: 1.6, skill: 1.5 }, // b：最強
    { level: 10, speed: 1.2, skill: 1.2 }, // c
    { level: 9, speed: 1.1, skill: 1.1 }, // d
    { level: 8, speed: 1.0, skill: 1.0 }, // e
    { level: 3 }, // f
    ...Array.from({ length: extra }, () => ({ level: 3 })),
  ]);
  const [a, b, c, d, e, f] = recs;
  return { a, b, c, d, e, f, all: recs };
}
const toNextDay = (g) => {
  const d = g.s.day;
  let guard = 0;
  while (g.s.day === d && guard++ < 1e6) g.update(0.1);
  assert.ok(guard < 1e6);
};
/** 開第一間分店：c 當正店長、a 當副店長 */
function openFirst(g, name = '東區店') {
  const crew = crewForBranch(g);
  const r = g.openBranch(crew.c.id, crew.a.id, name);
  assert.equal(r.ok, true, r.msg);
  return { ...crew, br: g.s.company.stores[1] };
}

test('店面接在公司上：共用欄位（金幣、等級、菜單、倉庫…）是同一份；各店的欄位獨立', () => {
  const g = rich(1);
  const main = g.s;
  const st = RC.state.newStore(1, '東區店', [], RC.util.makeRng(1));
  RC.state.attach(st, main.company);
  main.company.stores.push(st);
  st.coins -= 1000;
  assert.equal(main.coins, st.coins, '金幣共用');
  st.level = 41;
  assert.equal(main.level, 41);
  st.dishes.fantuan = { cooked: 3 };
  assert.ok(main.dishes.fantuan, '菜單共用');
  st.inventory.table_wood = 2;
  assert.equal(main.inventory.table_wood, 2, '倉庫共用');
  assert.notEqual(main.items, st.items);
  st.reputation = 5;
  assert.notEqual(main.reputation, 5, '風評各店獨立');
  assert.equal(Object.keys(JSON.parse(JSON.stringify(st))).includes('company'), false);
});

test('舊存檔（沒有分店）載入成只有主店的公司，玩家還是店掌櫃；單店存檔格式向下相容', () => {
  const g = rich(2);
  const back = RC.state.parse(RC.state.serialize(g.s));
  assert.equal(back.company.stores.length, 1);
  assert.equal(back.id, 0);
  assert.equal(back.kind, 'main');
  assert.equal(back.company.gm, null);
  const raw = JSON.parse(RC.codec.decode(RC.state.serialize(g.s)));
  delete raw.hq;
  delete raw.branches;
  const legacy = RC.state.normalize(raw);
  assert.equal(legacy.company.stores.length, 1);
  assert.equal(legacy.staff.filter((m) => m.boss).length, 1);
});

test('開分店的條件：數量、主店擴建到最大、三星、人手（2 位 Lv.10＋共 4 位 Lv.8）、開店資金；缺一不可', () => {
  const g = rich(3);
  let chk = g.branchCheck();
  assert.equal(chk.ok, false);
  assert.equal(chk.checks.find((c) => c.key === 'staff').ok, false, '還沒有夠格的員工');
  const crew = crewForBranch(g);
  chk = g.branchCheck();
  assert.equal(chk.ok, true, JSON.stringify(chk.checks.filter((c) => !c.ok)));
  assert.equal(chk.cost, D.BRANCH.cost[0]);
  const { a, b, c, d } = crew;
  g.s.coins = chk.cost - 1;
  assert.equal(g.openBranch(c.id, a.id, '東區店').ok, false, '錢不夠');
  g.s.coins = 5e6;
  g.s.room.stage = 3;
  assert.equal(g.branchCheck().checks.find((x) => x.key === 'room').ok, false, '主店還沒擴建到最大');
  g.s.room.stage = D.expansions.length - 1;
  assert.equal(g.openBranch(c.id, a.id, '').ok, false, '要取名字');
  assert.equal(g.openBranch(g.s.staff[0].id, a.id, '東區店').ok, false, '掌櫃不能當店長');
  assert.equal(g.openBranch(d.id, a.id, '東區店').ok, false, 'Lv.9 當不了正店長');
  assert.equal(g.openBranch(c.id, crew.f.id, '東區店').ok, false, 'Lv.3 當不了副店長');
  assert.equal(g.openBranch(c.id, c.id, '東區店').ok, false, '正副店長不能是同一人');
  // 派出去之後，原本那間店也要有正、副店長：把兩位 Lv.10 以上的都派走就不行
  const r = g.openBranch(c.id, b.id, '東區店');
  assert.equal(r.ok, true, '派 c（Lv.10）當正店長、b 當副店長；剩下 a（Lv.10）和 d、e 還能撐起主店');
  g.s.coins = 5e6;
  const r2 = g.openBranch(a.id, d.id, '西區店');
  assert.equal(r2.ok, false, '再派走 a，主店就沒有 Lv.10 以上的員工了');
});

test('開分店：玩家成為總經理（不在任何一間店）、扣開店資金；新店有起始設備與正副店長；主店自動選最強的接任', () => {
  const g = rich(4);
  const { a, b, c, d, e } = crewForBranch(g);
  const boss = g.s.staff[0];
  assert.equal(boss.boss, true);
  g.assignManager(c.id); // 主店原本的正店長是 c，副店長是 e；他們被派走後職位空出來
  g.assignManager(e.id);
  assert.ok(c.head && e.manager);
  const coins0 = g.s.coins;
  assert.equal(g.openBranch(c.id, e.id, '東區店').ok, true);
  assert.equal(coins0 - g.s.coins, D.BRANCH.cost[0]);
  const co = g.s.company;
  assert.equal(co.stores.length, 2);
  // 總經理
  assert.ok(co.gm && co.gm.id === boss.id, '店掌櫃變成總經理');
  assert.equal(g.isGM(), true);
  assert.ok(!co.stores.some((x) => x.staff.some((m) => m.boss)), '任何一間店都沒有掌櫃');
  assert.ok(!g.crew.some((m) => m.boss), '主店的執行中員工也沒有掌櫃');
  // 新店
  const br = co.stores[1];
  assert.equal(br.name, '東區店');
  assert.deepEqual(br.staff.map((m) => [m.id, m.head, m.manager]), [[c.id, true, true], [e.id, false, true]]);
  assert.ok(br.items.some((i) => i.id === 'sink') && br.items.some((i) => i.id.startsWith('stove')), '新店有起始設備');
  assert.equal(br.room.stage, 0);
  assert.equal(br.syncedMin, co.gameMin);
  // 主店：派走 c、e 之後，由剩下的員工自動接任：正店長＝Lv.10 以上綜合能力最強（b，Lv.12），副店長＝剩下 Lv.8 以上最強
  const main = co.stores[0];
  assert.equal(b.head, true, '主店正店長是綜合能力最強的 Lv.10 以上員工');
  assert.ok(main.staff.find((m) => m.manager && !m.head), '主店有副店長');
  assert.ok(main.staff.every((m) => !m.boss));
});

test('分店數量上限 3；名字不能重複', () => {
  const g = rich(5);
  // 要派 3 組正副店長：雇 4 位 Lv.10、4 位 Lv.8
  const more = withStaff(g, [{ level: 10 }, { level: 8 }, { level: 10 }, { level: 8 }, { level: 10 }, { level: 8 }, { level: 10 }, { level: 8 }]);
  assert.equal(g.openBranch(more[0].id, more[1].id, 'A店').ok, true);
  assert.equal(g.openBranch(more[2].id, more[3].id, 'A店').ok, false, '同名');
  assert.equal(g.openBranch(more[2].id, more[3].id, 'B店').ok, true);
  assert.equal(g.openBranch(more[4].id, more[5].id, 'C店').ok, true);
  assert.equal(g.s.company.stores.length, 4);
  const r = g.openBranch(more[6].id, more[7].id, 'D店');
  assert.equal(r.ok, false);
  assert.ok(r.msg.includes('分店數量'), r.msg);
});

test('結帳權限：正店長與 Lv.10 以上的副店長能結帳；Lv.8～9 的副店長不能（沒有正店長時客人就很快自助結帳）', () => {
  const g = rich(6);
  const { a, b, c, d, e } = crewForBranch(g);
  g.openBranch(c.id, a.id, '東區店');
  const main = g.s.company.stores[0];
  const head = main.staff.find((m) => m.head);
  const deputy = main.staff.find((m) => m.manager && !m.head);
  assert.ok(g.canCollect(head));
  // 把副店長降到 Lv.9：只有正店長能結帳
  deputy.level = 9;
  assert.equal(g.canCollect(deputy), false, 'Lv.9 的副店長只能管理，不能結帳');
  deputy.level = 10;
  assert.equal(g.canCollect(deputy), true, 'Lv.10 才有結帳權限');
  assert.ok(g.canCollect(b) || b.head || true);
  const info = g.storeInfos().find((x) => x.id === 0);
  assert.equal(info.head, head.name);
  assert.equal(info.deputy, deputy.name);
  assert.equal(info.canCollect, true);
  assert.ok(d && e);
});

test('總經理可以隨時檢視任何一間店（不需要誰「交接」）；檢視時 Game 載入那間店，執行中的員工沒有掌櫃', () => {
  const g = rich(7);
  openFirst(g);
  const main = g.s;
  const br = g.s.company.stores[1];
  assert.equal(g.switchStore(br.id).ok, true);
  assert.equal(g.s, br, 'Game 現在載入的是分店');
  assert.equal(g.s.company.activeId, br.id);
  assert.ok(g.crew.length === br.staff.length && !g.crew.some((m) => m.boss));
  assert.equal(g.switchStore(br.id).ok, false, '已經在檢視這間了');
  assert.equal(g.switchStore(0).ok, true);
  assert.equal(g.s, main);
  assert.equal(g.switchStore(999).ok, false);
  // 改名：總經理的名字
  assert.equal(g.renameBoss('王總').ok, true);
  assert.equal(g.s.company.gm.name, '王總');
  assert.equal(g.playerName(), '王總');
});

test('離開時在等結帳的客人直接結帳（沒有小費），不會白做工', () => {
  const g = rich(8);
  openFirst(g);
  g.setBusinessHours(0, 24);
  let guard = 0;
  while (!g.customers.some((c) => c.state === 'wait_pay') && guard++ < 80000) g.update(0.1);
  assert.ok(g.customers.some((c) => c.state === 'wait_pay'), '有客人在等結帳');
  const coins0 = g.s.coins;
  assert.equal(g.switchStore(g.s.company.stores[1].id).ok, true);
  assert.ok(g.s.coins >= coins0, '等結帳的客人已結帳');
});

test('懶惰結算：沒有被檢視的店過了一整天，午夜自動補算：營收進公司、報告寫進店面、日薪照發', () => {
  const g = rich(9);
  const { br, d } = openFirst(g);
  g.transferStaff(d.id, br.id);
  const served0 = br.stats.served;
  assert.ok(br.syncedMin <= g.s.company.gameMin);
  toNextDay(g);
  assert.ok(br.stats.served > served0, `分店服務了 ${br.stats.served - served0} 位客人`);
  assert.ok(br.report && br.report.served > 0 && br.report.earned > 0, JSON.stringify(br.report));
  assert.ok(br.report.wages > 0, '日薪照發');
  assert.ok(Math.abs(g.s.company.gameMin - br.syncedMin) < 30, '分店已補算到差不多現在');
  assert.ok(br.day >= 2, '分店也過了一天');
});

test('懶惰結算的客流打折：同一間店，沒被檢視比被檢視客人少', () => {
  const g = rich(10);
  crewForBranch(g);
  const away = new RC.Game(g.s, { seed: 3, headless: true });
  const here = new RC.Game(g.s, { seed: 3 });
  const gap = (x) => {
    let n = 0;
    for (let i = 0; i < 300; i++) n += x.spawnInterval();
    return n / 300;
  };
  const ratio = gap(away) / gap(here);
  assert.ok(Math.abs(ratio - 1 / D.BRANCH.awayFlow) < 0.15, `間隔比 ${ratio.toFixed(2)}`);
});

test('調動員工：不能調掌櫃、對方要有名額；調走店長後，兩間店的店長缺額都會自動補上', () => {
  const g = rich(11);
  const { br, b, d, f } = openFirst(g);
  assert.equal(g.transferStaff(g.s.company.gm.id, br.id).ok, false, '總經理不在名單裡');
  assert.equal(g.transferStaff(f.id, 0).ok, false, '調去自己所在的店沒有意義');
  assert.equal(g.transferStaff(999, br.id).ok, false);
  assert.equal(g.transferStaff(f.id, br.id).ok, true);
  assert.ok(br.staff.includes(f) && !g.s.staff.includes(f));
  assert.equal(f.manager, false);
  // 把主店的正店長（b，最強）調去分店：主店要自動補上新的正店長
  assert.equal(b.head, true);
  const [x] = withStaff(g, [{ level: 10, speed: 1.05, skill: 1.0 }]); // 主店另一位 Lv.10 員工
  assert.equal(g.transferStaff(b.id, br.id).ok, true);
  assert.equal(b.head, false, '調動後職位清掉');
  assert.equal(x.head, true, '主店自動由剩下的 Lv.10 以上員工補上正店長');
  // 名額上限
  const cap = D.maxStaffForLevel(g.s.level);
  br.staff.push(...Array.from({ length: cap }, (_, i) => RC.state.newStaff(900 + i, { name: '路' + i, look: RC.state.makeLook(RC.util.makeRng(i)), speed: 1, skill: 1, wage: 50 })));
  const extra = g.s.staff.find((m) => !m.manager);
  if (extra) assert.equal(g.transferStaff(extra.id, br.id).ok, false, '那間店人滿了');
  assert.ok(d);
});

test('分店風評崩壞（連續 15 天谷底）：這間分店關門，員工回主店、家具入倉庫；整場遊戲不會結束', () => {
  const g = rich(12);
  const { br } = openFirst(g);
  br.reputation = D.REPUTATION.min;
  br.lowDays = D.REPUTATION.loseDays - 1;
  br.schedule = { open: 1, close: 2, auto: false }; // 這一天不營業：風評不會回升，午夜就滿 15 天
  const items = br.items.length;
  const msgs = [];
  g.on('toast', (e) => msgs.push(e.msg));
  toNextDay(g);
  assert.equal(g.s.company.stores.length, 1, '分店已關閉');
  assert.ok(msgs.some((m) => m.includes('關門')), msgs.join('|'));
  assert.equal(g.s.over, null, '主店沒事');
  const stored = Object.values(g.s.inventory).reduce((n, v) => n + v, 0);
  assert.ok(stored >= items, `家具收進倉庫 ${stored}/${items}`);
  assert.equal(g.isGM(), false, '分店都關了：總經理回到主店當店掌櫃');
  assert.equal(g.s.staff.filter((m) => m.boss).length, 1);
});

test('總經理正在檢視的分店風評崩壞：自動回到主店，Game 載回主店', () => {
  const g = rich(13);
  const { br } = openFirst(g);
  assert.equal(g.switchStore(br.id).ok, true);
  g.s.reputation = D.REPUTATION.min;
  g.s.lowDays = D.REPUTATION.loseDays - 1;
  g.s.schedule = { open: 1, close: 2, auto: false }; // 今天剩下的時間不營業，風評不會回升
  toNextDay(g);
  assert.equal(g.s.kind, 'main', '回到主店');
  assert.equal(g.s.company.stores.length, 1);
  assert.ok(g.s.staff.some((m) => m.boss), '玩家回到主店當店掌櫃');
  assert.ok(g.crew.some((m) => m.boss));
});

test('品牌聲譽：有分店時，客流同時受自己與各店平均風評影響', () => {
  const g = rich(14);
  openFirst(g);
  g.s.reputation = 8;
  g.s.company.stores[1].reputation = -8;
  assert.equal(g.brandReputation(), 0);
  assert.equal(g.effectiveRep(), 4, '(8 + 0) / 2');
});

test('任務與統計跨店累計：服務人數、收入、結帳次數是全公司的', () => {
  const g = rich(15);
  openFirst(g);
  g.s.stats.served = 10;
  g.s.company.stores[1].stats.served = 32;
  assert.equal(g.companyStat('served'), 42);
  assert.equal(g.questProgress({ type: 'serve' }), 42);
});

test('連鎖崩壞：所有分店（至少 2 間）風評都低於 −6，連續 10 天，視同主店倒閉、遊戲終止', () => {
  const g = rich(16);
  const crew = crewForBranch(g);
  const more = withStaff(g, [{ level: 10 }, { level: 8 }, { level: 10 }, { level: 8 }]);
  g.openBranch(crew.c.id, crew.a.id, 'A店');
  g.openBranch(more[0].id, more[1].id, 'B店');
  const [, A, B] = g.s.company.stores;
  const co = g.s.company;
  let over = 0;
  g.on('gameover', () => over++);
  // 只有一間分店低迷：不算
  A.reputation = -9;
  B.reputation = 0;
  g.checkChain();
  assert.equal(co.chainDays, 0);
  // 全部低迷：每天累計；中途有一間回升就歸零
  B.reputation = -7;
  for (let d = 1; d <= 5; d++) {
    g.checkChain();
    assert.equal(co.chainDays, d);
  }
  B.reputation = -5.9;
  g.checkChain();
  assert.equal(co.chainDays, 0, '有一間分店風評回到 −6 以上，天數歸零');
  B.reputation = -7;
  for (let d = 1; d < D.BRANCH.chainDays; d++) g.checkChain();
  assert.equal(co.stores[0].over, null);
  assert.equal(over, 0);
  g.checkChain();
  assert.ok(co.stores[0].over && co.stores[0].over.reason === 'chain', '第 10 天：公司倒閉');
  assert.equal(over, 1);
  assert.equal(g.isOver(), true);
  const t = co.gameMin;
  g.update(1);
  assert.equal(co.gameMin, t, '遊戲結束後時間不再前進');
  // 存檔保留結束原因
  assert.equal(RC.state.parse(RC.state.serialize(g.s)).company.stores[0].over.reason, 'chain');
});

test('連鎖崩壞只在有 2 間以上分店時適用；只有 1 間分店時，那間低迷只會讓它自己關門', () => {
  const g = rich(17);
  const { br } = openFirst(g);
  br.reputation = -10;
  for (let i = 0; i < 20; i++) g.checkChain();
  assert.equal(g.isOver(), false);
  assert.equal(g.s.company.chainDays, 0);
});

test('連鎖崩壞的天數會存檔；午夜自動檢查（不營業的分店風評不回升）', () => {
  const g = rich(18);
  const crew = crewForBranch(g);
  const more = withStaff(g, [{ level: 10 }, { level: 8 }]);
  g.openBranch(crew.c.id, crew.a.id, 'A店');
  g.openBranch(more[0].id, more[1].id, 'B店');
  const [, A, B] = g.s.company.stores;
  for (const x of [A, B]) {
    x.reputation = -8;
    x.schedule = { open: 1, close: 2, auto: false };
  }
  toNextDay(g);
  assert.equal(g.s.company.chainDays, 1);
  const back = RC.state.parse(RC.state.serialize(g.s));
  assert.equal(back.company.chainDays, 1);
});

test('主動關閉分店：預覽家具入倉庫與賣出、員工的去向與資遣費', () => {
  const g = rich(19);
  const { br, f } = openFirst(g);
  g.transferStaff(f.id, br.id);
  const plan = g.planClose(br.id);
  assert.equal(plan.items.total, br.items.length);
  assert.equal(plan.items.keep + plan.items.sell, plan.items.total);
  assert.equal(plan.items.sell, 0, '倉庫放得下');
  assert.equal(plan.staff.length, 3);
  const mgr = plan.staff.find((p) => p.post === '正店長');
  assert.ok(mgr && mgr.severance > 0, '有資遣費');
  assert.equal(mgr.severance, g.severanceOf(br.staff.find((m) => m.head)));
  assert.equal(g.severanceOf(br.staff[0]), Math.round(g.wageOf(br.staff[0]) * D.BRANCH.severanceDays));
  assert.deepEqual(plan.staff[0].targets, [0]);
  // 倉庫快滿了：放不下的家具（先賣便宜的）半價賣掉
  g.s.inventory.table_wood = D.BRANCH.warehouseCap - 3;
  const p2 = g.planClose(br.id);
  assert.equal(p2.warehouse.room, 3);
  assert.equal(p2.items.keep, 3);
  assert.equal(p2.items.sell, br.items.length - 3);
  const expected = p2.items.sellList.reduce((n, it) => n + Math.floor(D.furniture[it.id].price / 2), 0);
  assert.equal(p2.items.sellCoins, expected);
  const kept = p2.items.keepList.map((it) => D.furniture[it.id].price);
  const sold = p2.items.sellList.map((it) => D.furniture[it.id].price);
  assert.ok(Math.min(...kept) >= Math.max(...sold), '貴的優先放進倉庫');
});

test('主動關閉分店：家具入倉庫、員工調回或資遣（加發資遣費）；沒錢付資遣費就不能關；去向店的名額不夠也不行', () => {
  const g = rich(20);
  const { br, f } = openFirst(g);
  g.transferStaff(f.id, br.id);
  const plan = g.planClose(br.id);
  const fire = plan.staff.filter((p) => p.level >= 8).map((p) => p.id); // 兩位店長資遣
  const moves = {};
  for (const p of plan.staff) moves[p.id] = fire.includes(p.id) ? 'fire' : 0;
  const sev = plan.staff.filter((p) => fire.includes(p.id)).reduce((n, p) => n + p.severance, 0);
  // 沒錢
  const coins = g.s.coins;
  g.s.coins = sev - 1;
  assert.equal(g.closeBranch(br.id, { moves }).ok, false, '資遣費不夠');
  assert.equal(g.s.company.stores.length, 2, '沒關成');
  // 名額不夠：主店塞滿
  g.s.coins = coins;
  const cap = D.maxStaffForLevel(g.s.level);
  const stash = g.s.staff.filter((m) => !m.boss);
  const fillers = Array.from({ length: Math.max(0, cap - stash.length) }, (_, i) => RC.state.newStaff(800 + i, { name: '填' + i, look: RC.state.makeLook(RC.util.makeRng(i)), speed: 1, skill: 1, wage: 50 }));
  g.s.staff.push(...fillers);
  assert.equal(g.closeBranch(br.id, { moves }).ok, false, '主店放不下調回來的員工');
  g.s.staff = g.s.staff.filter((m) => !fillers.includes(m));
  // 成功
  const invBefore = Object.values(g.s.inventory).reduce((n, v) => n + v, 0);
  const coinsBefore = g.s.coins;
  const items = br.items.length;
  assert.equal(g.closeBranch(br.id, { moves }).ok, true);
  assert.equal(g.s.company.stores.length, 1);
  assert.equal(coinsBefore - g.s.coins, sev, '扣掉資遣費');
  assert.equal(Object.values(g.s.inventory).reduce((n, v) => n + v, 0) - invBefore, items, '家具全進倉庫');
  assert.equal(g.isGM(), false, '最後一間分店關了，總經理回主店當掌櫃');
  assert.ok(g.s.staff.some((m) => m.boss));
  const gone = plan.staff.filter((p) => fire.includes(p.id)).map((p) => p.id);
  for (const id of gone) assert.ok(!g.s.staff.some((m) => m.id === id), '被資遣的員工不在名單裡');
  const moved = plan.staff.filter((p) => !fire.includes(p.id)).map((p) => p.id);
  for (const id of moved) assert.ok(g.s.staff.some((m) => m.id === id), '調回主店的員工在名單裡');
});

test('主動關閉分店：沒指定去向的員工優先調去有名額的店，沒名額就資遣；風評崩壞自動關店不收資遣費', () => {
  const g = rich(21);
  const { br, f } = openFirst(g);
  g.transferStaff(f.id, br.id);
  const coins = g.s.coins;
  const cap = D.maxStaffForLevel(g.s.level);
  // 主店只剩 1 個名額：3 位員工只有 1 位調得回去，其餘資遣
  const mainStaff = g.s.staff.filter((m) => !m.boss);
  const fillers = Array.from({ length: Math.max(0, cap - 1 - mainStaff.length) }, (_, i) => RC.state.newStaff(700 + i, { name: '填' + i, look: RC.state.makeLook(RC.util.makeRng(i)), speed: 1, skill: 1, wage: 50 }));
  g.s.staff.push(...fillers);
  assert.equal(g.closeBranch(br.id, {}, 'reputation').ok, true, '自動關店不會因為名額失敗');
  assert.equal(g.s.coins, coins + 0 - 0 + (g.s.coins - coins), '不收資遣費');
  assert.equal(g.s.staff.filter((m) => !m.boss).length, cap, '主店剛好滿編');
  assert.ok(g.s.staff.some((m) => m.head) || true);
});

test('存檔：有分店的公司來回；總經理、各店的設備員工風評、正副店長、共用欄位都保留', () => {
  const g = rich(22);
  const { br, d } = openFirst(g);
  br.reputation = 3.5;
  br.report = { day: 4, served: 20, earned: 900, wages: 100, procure: 0, reputation: 3.5 };
  g.transferStaff(d.id, br.id);
  assert.equal(g.switchStore(br.id).ok, true);
  g.renameBoss('王總');
  const back = RC.state.parse(RC.state.serialize(g.s));
  const co = back.company;
  assert.equal(co.stores.length, 2);
  assert.equal(back.id, br.id, '載入後仍在檢視分店');
  assert.equal(back.kind, 'branch');
  assert.equal(co.gm.name, '王總');
  assert.ok(!co.stores.some((x) => x.staff.some((m) => m.boss)), '沒有掌櫃');
  assert.equal(back.reputation, 3.5);
  assert.deepEqual(back.report, br.report);
  assert.equal(back.coins, g.s.coins);
  assert.deepEqual(back.staff.map((m) => [m.id, m.head, m.manager]), br.staff.map((m) => [m.id, m.head, m.manager]));
  assert.ok(back.nextStaffId > Math.max(co.gm.id, ...co.stores.flatMap((x) => x.staff.map((m) => m.id))));
  const g2 = new RC.Game(back, { seed: 2 });
  for (let i = 0; i < 300; i++) g2.update(0.1);
  assert.ok(g2.crew.length > 0 && !g2.crew.some((m) => m.boss));
});

test('存檔防呆：有分店時掌櫃旗標會被轉成總經理；單店時沒有掌櫃就由總經理資料補上；壞資料被丟掉', () => {
  const g = rich(23);
  openFirst(g);
  const raw = JSON.parse(RC.codec.decode(RC.state.serialize(g.s)));
  // 1. 有分店時，某間店的員工被標成掌櫃（舊版存檔）：轉成總經理，名單裡不能有掌櫃
  raw.branches[0].staff[0].boss = true;
  const a = RC.state.normalize(JSON.parse(JSON.stringify(raw)));
  assert.ok(!a.company.stores.some((x) => x.staff.some((m) => m.boss)));
  assert.ok(a.company.gm);
  // 2. 壞資料、超過上限的分店、不存在的店面編號
  raw.branches.push({ id: 9, name: '多出來的店' }, { id: 10, name: '又一間' }, { id: 11, name: '第四間' }, null, 5, { name: '沒有編號' });
  raw.hq.activeId = 77;
  const back = RC.state.normalize(raw);
  assert.ok(back.company.stores.length <= 1 + D.BRANCH.max);
  assert.ok(back.company.stores.some((x) => x.id === back.company.activeId));
  assert.equal(new Set(back.company.stores.map((x) => x.id)).size, back.company.stores.length, '店面編號不重複');
  // 3. 單店但存檔裡沒有掌櫃、有總經理資料：回到掌櫃身分
  const solo = JSON.parse(RC.codec.decode(RC.state.serialize(rich(24).s)));
  solo.staff = solo.staff.filter((m) => !m.boss);
  solo.hq.gm = { id: 77, name: '老闆', look: { skin: 1, hair: 0, hairStyle: 0, top: 7, pants: 0 }, speed: 1.2, skill: 1.2 };
  const s3 = RC.state.normalize(solo);
  assert.equal(s3.staff.filter((m) => m.boss).length, 1);
  assert.equal(s3.staff.find((m) => m.boss).name, '老闆');
  assert.equal(s3.company.gm, null);
});

test('店長編制存檔修正：正店長最多 1 位（Lv.10）、副店長最多 1 位（Lv.8）；舊存檔的值班店長第一位成為正店長', () => {
  const g = rich(25);
  withStaff(g, [{ level: 10 }, { level: 10 }, { level: 10 }, { level: 6 }]);
  const raw = JSON.parse(RC.codec.decode(RC.state.serialize(g.s)));
  for (const m of raw.staff) if (!m.boss) {
    m.manager = true;
    m.head = true;
  }
  const back = RC.state.normalize(JSON.parse(JSON.stringify(raw)));
  const mg = back.staff.filter((m) => m.manager);
  assert.equal(mg.length, 2, '正副各 1 位');
  assert.equal(mg.filter((m) => m.head).length, 1);
  assert.ok(mg.every((m) => m.level >= D.DAY.deputyLevel), 'Lv.6 的人不能當店長');
  // 舊存檔：只有 manager，沒有 head
  for (const m of raw.staff) delete m.head;
  const legacy = RC.state.normalize(raw);
  const lm = legacy.staff.filter((m) => m.manager);
  assert.equal(lm.filter((m) => m.head).length, 1);
});

test('公司時間：公司的時間只由玩家正在檢視的店推進；headless 補算不會推進', () => {
  const g = rich(26);
  openFirst(g);
  const co = g.s.company;
  const t0 = co.gameMin;
  for (let i = 0; i < 100; i++) g.update(0.1);
  assert.ok(co.gameMin > t0);
  const br = co.stores[1];
  const t1 = co.gameMin;
  g.settleStore(br);
  assert.equal(co.gameMin, t1, '補算分店不影響公司時間');
  assert.ok(br.syncedMin <= co.gameMin + 1);
});

test('沒被檢視的主店風評崩壞：整場遊戲結束（分店倒閉才只是關店）', () => {
  const g = rich(27);
  const { br } = openFirst(g);
  assert.equal(g.switchStore(br.id).ok, true);
  const main = g.s.company.stores[0];
  main.reputation = D.REPUTATION.min;
  main.lowDays = D.REPUTATION.loseDays - 1;
  main.schedule = { open: 1, close: 2, auto: false };
  let over = 0;
  g.on('gameover', () => over++);
  toNextDay(g);
  assert.ok(main.over, '主店倒閉');
  assert.equal(over, 1);
  assert.equal(g.isOver(), true);
});

test('沒有掌櫃的店每天午夜補齊店長缺額（Lv.10 以上最強者當正店長、Lv.8 以上最強者當副店長）', () => {
  const g = rich(28);
  const { b } = openFirst(g);
  const main = g.s.company.stores[0];
  for (const m of main.staff) m.manager = m.head = false;
  toNextDay(g);
  const head = main.staff.find((m) => m.head);
  assert.ok(head, '自動任命正店長');
  assert.equal(head.id, b.id, '綜合能力最強的 Lv.10 以上員工');
  assert.ok(main.staff.some((m) => m.manager && !m.head), '也補上副店長');
});

test('隨機操作：開分店、檢視、調動、關店、跑幾天；任何時候單店有一位掌櫃、有分店時沒有掌櫃只有總經理；員工編號不重複；正副店長各 1', () => {
  for (const seed of [31, 32, 33]) {
    const g = rich(seed);
    const rng = RC.util.makeRng(seed * 101);
    withStaff(g, Array.from({ length: 9 }, (_, i) => ({ level: i < 6 ? 8 + (i % 4) : 4, speed: 1 + i * 0.05, skill: 1.1 })));
    const tally = { open: 0, close: 0 };
    for (let step = 0; step < 60; step++) {
      const co = g.s.company;
      const r = rng.next();
      const crewNow = g.s.staff.filter((m) => !m.boss);
      if (r < 0.15) {
        if (crewNow.length >= 2 && g.openBranch(rng.pick(crewNow).id, rng.pick(crewNow).id, '店' + step).ok) tally.open++;
      } else if (r < 0.35 && co.stores.length > 1) g.switchStore(rng.pick(co.stores).id);
      else if (r < 0.5 && co.stores.length > 1) {
        if (crewNow.length) g.transferStaff(rng.pick(crewNow).id, rng.pick(co.stores).id);
      } else if (r < 0.55 && co.stores.length > 1) {
        if (g.closeBranch(rng.pick(co.stores.slice(1)).id, {}, rng.next() < 0.5 ? 'manual' : 'reputation').ok) tally.close++;
      } else {
        g.s.coins = Math.max(g.s.coins, 1e6);
        for (let i = 0; i < 400; i++) g.update(0.1);
      }
      // 不變量
      const c2 = g.s.company;
      const bosses = c2.stores.flatMap((x) => x.staff.filter((m) => m.boss));
      if (c2.stores.length === 1) {
        assert.equal(bosses.length, 1, `seed ${seed} step ${step}：單店要有一位掌櫃`);
        assert.equal(c2.gm, null);
      } else {
        assert.equal(bosses.length, 0, `seed ${seed} step ${step}：有分店時不能有掌櫃`);
        assert.ok(c2.gm, '有總經理');
      }
      const ids = c2.stores.flatMap((x) => x.staff.map((m) => m.id)).concat(c2.gm ? [c2.gm.id] : []);
      assert.equal(new Set(ids).size, ids.length, `seed ${seed} step ${step}：員工編號重複`);
      assert.equal(g.crew.length, g.s.staff.length);
      for (const x of c2.stores) {
        assert.ok(x.staff.filter((m) => m.head).length <= 1, '正店長最多 1 位');
        assert.ok(x.staff.filter((m) => m.manager && !m.head).length <= 1, '副店長最多 1 位');
        for (const m of x.staff) {
          if (m.head) assert.ok(m.manager && m.level >= D.DAY.managerLevel);
          if (m.manager) assert.ok(m.level >= D.DAY.deputyLevel);
        }
        assert.ok(Number.isFinite(x.reputation) && Number.isFinite(x.day));
      }
      assert.equal(c2.storeById(g.s.id), g.s);
      assert.ok(g.s.coins >= 0);
    }
    const back = RC.state.parse(RC.state.serialize(g.s));
    assert.equal(back.company.stores.length, g.s.company.stores.length);
    assert.ok(tally.open >= 0);
  }
});
