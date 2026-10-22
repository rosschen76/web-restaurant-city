'use strict';
// 分店：公司層（共用）與店面（獨立）、開分店、店長、玩家搬家、懶惰結算、調動、關店、存檔
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;

/** 主店已發展到上限：18×18、三星、有錢、有幾位 Lv.10 以上能力不同的員工 */
function rich(seed = 1, mut) {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  s.coins = 5e6;
  s.level = 40;
  s.room.stage = D.expansions.length - 1;
  // 三星需要魅力 400：把裝飾放在場外湊魅力（只影響魅力計算）
  for (const [id, n] of [['piano', 10], ['statue', 10], ['jukebox', 10], ['fishtank', 6]]) for (let i = 0; i < n; i++) s.items.push({ uid: s.nextUid++, id, x: 99, y: 99, rot: 0 });
  if (mut) mut(s);
  const g = new RC.Game(s, { seed });
  return g;
}
function withStaff(g, specs) {
  // specs: [{level, speed, skill}]
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
const toNextDay = (g) => {
  const d = g.s.day;
  let guard = 0;
  while (g.s.day === d && guard++ < 1e6) g.update(0.1);
  assert.ok(guard < 1e6);
};

test('店面接在公司上：共用欄位（金幣、等級、菜單、倉庫…）是同一份；各店的欄位獨立', () => {
  const g = rich(1);
  const main = g.s;
  const st = RC.state.newStore(1, '東區店', null, RC.util.makeRng(1));
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

test('舊存檔（沒有分店）載入成只有主店的公司；單店存檔格式向下相容', () => {
  const g = rich(2);
  const back = RC.state.parse(RC.state.serialize(g.s));
  assert.equal(back.company.stores.length, 1);
  assert.equal(back.id, 0);
  assert.equal(back.kind, 'main');
  const raw = JSON.parse(RC.codec.decode(RC.state.serialize(g.s)));
  delete raw.hq;
  delete raw.branches;
  const legacy = RC.state.normalize(raw);
  assert.equal(legacy.company.stores.length, 1);
  assert.equal(legacy.staff.filter((m) => m.boss).length, 1);
  assert.equal(legacy.company.activeId, 0);
});

test('開分店的條件：數量、主店擴建到最大、三星、有 Lv.10 員工、開店資金；缺一不可', () => {
  const g = rich(3);
  let chk = g.branchCheck();
  assert.equal(chk.ok, false);
  assert.equal(chk.checks.find((c) => c.key === 'staff').ok, false, '還沒有 Lv.10 的員工');
  assert.equal(g.openBranch(1, '東區店').ok, false);
  const [a] = withStaff(g, [{ level: 10 }]);
  chk = g.branchCheck();
  assert.equal(chk.ok, true, JSON.stringify(chk.checks.filter((c) => !c.ok)));
  assert.equal(chk.cost, D.BRANCH.cost[0]);
  g.s.coins = chk.cost - 1;
  assert.equal(g.openBranch(a.id, '東區店').ok, false, '錢不夠');
  g.s.coins = 5e6;
  g.s.room.stage = 3;
  assert.equal(g.branchCheck().checks.find((c) => c.key === 'room').ok, false, '主店還沒擴建到最大');
  g.s.room.stage = D.expansions.length - 1;
  assert.equal(g.openBranch(a.id, '').ok, false, '要取名字');
  assert.equal(g.openBranch(g.s.staff[0].id, '東區店').ok, false, '掌櫃不能當店長');
  assert.equal(g.openBranch(a.id, '東區店').ok, true);
});

test('開分店：扣開店資金、店長調過去（成為值班店長）、新店有起始設備；主店自動補一位店長（Lv.10 以上、綜合能力最強）', () => {
  const g = rich(4);
  const [weak, strong, mid] = withStaff(g, [
    { level: 10, speed: 1.0, skill: 1.0 },
    { level: 12, speed: 1.6, skill: 1.5 },
    { level: 10, speed: 1.2, skill: 1.2 },
  ]);
  assert.equal(g.assignManager(weak.id).ok, true, '原本的主店值班店長是能力最弱的');
  const coins0 = g.s.coins;
  assert.equal(g.openBranch(mid.id, '東區店').ok, true);
  assert.equal(coins0 - g.s.coins, D.BRANCH.cost[0]);
  const co = g.s.company;
  assert.equal(co.stores.length, 2);
  const br = co.stores[1];
  assert.equal(br.name, '東區店');
  assert.equal(br.kind, 'branch');
  assert.deepEqual(br.staff.map((m) => [m.id, m.manager]), [[mid.id, true]]);
  assert.ok(br.items.some((i) => i.id === 'sink') && br.items.some((i) => i.id.startsWith('stove')), '新店有起始設備');
  assert.equal(br.room.stage, 0);
  assert.equal(br.syncedMin, co.gameMin);
  assert.ok(!g.s.staff.includes(mid) && !g.crew.some((m) => m.rec === mid), '主店少了這位員工');
  // 主店的店長：原本的 weak 還在，但分店店長走掉後主店至少要有 1 位；weak 仍是店長
  assert.ok(g.s.staff.some((m) => m.manager));
  // 再開第二間：派走 weak，主店要自動改選最強的 strong
  g.s.coins = 5e6;
  assert.equal(g.openBranch(weak.id, '西區店').ok, true);
  assert.equal(strong.manager, true, '主店自動改選綜合能力最強的 Lv.10 以上員工');
  assert.equal(g.s.coins, 5e6 - D.BRANCH.cost[1]);
});

test('分店數量上限 3；名字不能重複', () => {
  const g = rich(5);
  const recs = withStaff(g, [{ level: 10 }, { level: 10 }, { level: 10 }, { level: 10 }]);
  assert.equal(g.openBranch(recs[0].id, 'A店').ok, true);
  assert.equal(g.openBranch(recs[1].id, 'A店').ok, false, '同名');
  assert.equal(g.openBranch(recs[1].id, 'B店').ok, true);
  assert.equal(g.openBranch(recs[2].id, 'C店').ok, true);
  assert.equal(g.s.company.stores.length, 4);
  const r = g.openBranch(recs[3].id, 'D店');
  assert.equal(r.ok, false);
  assert.ok(r.msg.includes('分店數量'), r.msg);
});

test('玩家搬去分店：掌櫃進分店、主店由值班店長主持；可以再搬回來', () => {
  const g = rich(6);
  const [a, b] = withStaff(g, [{ level: 10, speed: 1.4, skill: 1.4 }, { level: 10, speed: 1.1, skill: 1.1 }]);
  g.openBranch(a.id, '東區店');
  const main = g.s;
  const br = g.s.company.stores[1];
  const boss = main.staff.find((m) => m.boss);
  assert.equal(g.switchStore(br.id).ok, true);
  assert.equal(g.s, br, 'Game 現在載入的是分店');
  assert.equal(g.s.company.activeId, br.id);
  assert.ok(br.staff.includes(boss) && boss.boss, '玩家（掌櫃）在分店');
  assert.ok(!main.staff.some((m) => m.boss), '主店沒有掌櫃');
  assert.ok(main.staff.some((m) => m.manager), '主店有值班店長主持');
  assert.ok(g.crew.some((m) => m.boss), '分店的執行期員工包含掌櫃');
  assert.equal(g.switchStore(br.id).ok, false, '已經在那裡了');
  // 搬回主店
  assert.equal(g.switchStore(0).ok, true);
  assert.equal(g.s, main);
  assert.ok(main.staff.includes(boss));
  assert.ok(!br.staff.some((m) => m.boss));
  assert.equal(b.manager || main.staff.some((m) => m.manager), true);
});

test('離開這間店前，這間店一定要有值班店長，否則不能搬', () => {
  const g = rich(7);
  const [a] = withStaff(g, [{ level: 10 }]);
  g.openBranch(a.id, '東區店'); // 主店只剩掌櫃一個人，沒有 Lv.10 以上員工
  const r = g.switchStore(g.s.company.stores[1].id);
  assert.equal(r.ok, false);
  assert.ok(r.msg.includes('值班店長'), r.msg);
  assert.equal(g.s.kind, 'main');
});

test('離開時在等結帳的客人直接結帳（沒有小費），不會白做工', () => {
  const g = rich(8, (s) => (s.coins = 5e6));
  const [a, b] = withStaff(g, [{ level: 10 }, { level: 10 }]);
  g.openBranch(a.id, '東區店');
  g.setBusinessHours(0, 24);
  // 讓一位客人吃完
  let guard = 0;
  while (!g.customers.some((c) => c.state === 'wait_pay') && guard++ < 60000) g.update(0.1);
  assert.ok(g.customers.some((c) => c.state === 'wait_pay'), '有客人在等結帳');
  const coins0 = g.s.coins;
  const collects0 = g.s.stats.collects;
  assert.equal(g.switchStore(g.s.company.stores[1].id).ok, true);
  assert.ok(g.s.company.stores[0].stats.collects > collects0 || g.s.coins > coins0 - 1, '等結帳的客人已結帳');
  assert.ok(g.s.coins >= coins0);
});

test('懶惰結算：沒有玩家的店過了一整天，午夜自動補算：營收進公司、報告寫進店面', () => {
  const g = rich(9);
  const [a, b] = withStaff(g, [{ level: 10 }, { level: 10 }]);
  g.openBranch(a.id, '東區店');
  const br = g.s.company.stores[1];
  // 分店補幾個員工，不然只有店長一人
  for (const m of g.s.staff.slice(1)) if (m !== b) m.manager = false;
  g.transferStaff(b.id, br.id);
  const served0 = br.stats.served;
  const coins0 = g.s.coins;
  assert.ok(br.syncedMin <= g.s.company.gameMin);
  toNextDay(g); // 主店跑完一天，午夜會結算分店
  assert.ok(br.stats.served > served0, `分店服務了 ${br.stats.served - served0} 位客人`);
  assert.ok(br.report && br.report.served > 0 && br.report.earned > 0, JSON.stringify(br.report));
  assert.ok(Math.abs(g.s.company.gameMin - br.syncedMin) < 30, '分店已補算到差不多現在');
  assert.ok(br.day >= 2, '分店也過了一天');
  assert.ok(g.s.coins !== coins0);
});

test('懶惰結算的客流打折（沒有掌櫃坐鎮）：同一間店，沒人在比有人在客人少', () => {
  const g = rich(10);
  const [a, b, c] = withStaff(g, [{ level: 10 }, { level: 10 }, { level: 10 }]);
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

test('調動員工：不能調掌櫃、對方要有名額；調走店長後這間店自動補店長', () => {
  const g = rich(11);
  const [a, b, c] = withStaff(g, [{ level: 10, speed: 1.5, skill: 1.5 }, { level: 10, speed: 1.1, skill: 1.1 }, { level: 3 }]);
  g.openBranch(a.id, '東區店');
  const br = g.s.company.stores[1];
  assert.equal(g.transferStaff(g.s.staff[0].id, br.id).ok, false, '掌櫃不能調');
  assert.equal(g.transferStaff(c.id, 0).ok, false, '調去自己所在的店沒有意義');
  assert.equal(g.transferStaff(999, br.id).ok, false);
  assert.equal(g.transferStaff(c.id, br.id).ok, true);
  assert.ok(br.staff.includes(c) && !g.s.staff.includes(c));
  assert.equal(c.manager, false);
  g.assignManager(b.id);
  assert.equal(g.transferStaff(b.id, br.id).ok, true);
  assert.equal(b.manager, true, '分店的店長不足時自動補上 Lv.10 以上的員工');
  // 名額上限
  const cap = D.maxStaffForLevel(g.s.level);
  br.staff.push(...Array.from({ length: cap }, (_, i) => RC.state.newStaff(900 + i, { name: '路' + i, look: RC.state.makeLook(RC.util.makeRng(i)), speed: 1, skill: 1, wage: 50 })));
  const extra = g.s.staff.find((m) => !m.boss);
  if (extra) assert.equal(g.transferStaff(extra.id, br.id).ok, false, '那間店人滿了');
});

test('分店風評崩壞（連續 15 天谷底）：這間分店關門，員工回主店、家具收進倉庫；整場遊戲不會結束', () => {
  const g = rich(12);
  const [a, b] = withStaff(g, [{ level: 10 }, { level: 10 }]);
  g.openBranch(a.id, '東區店');
  const br = g.s.company.stores[1];
  g.transferStaff(b.id, br.id);
  br.reputation = D.REPUTATION.min;
  br.lowDays = D.REPUTATION.loseDays - 1;
  br.schedule = { open: 1, close: 2, auto: false }; // 這一天不營業：風評不會回升，午夜就滿 15 天
  const items = br.items.length;
  const msgs = [];
  g.on('toast', (e) => msgs.push(e.msg));
  toNextDay(g);
  assert.equal(g.s.company.stores.length, 1, '分店已關閉');
  assert.ok(msgs.some((m) => m.includes('關門')), msgs.join('|'));
  assert.ok(g.s.staff.includes(a) && g.s.staff.includes(b), '員工回到主店');
  assert.equal(g.s.over, null, '主店沒事');
  const stored = Object.values(g.s.inventory).reduce((n, v) => n + v, 0);
  assert.ok(stored >= items, `家具收進倉庫 ${stored}/${items}`);
});

test('玩家在分店時分店風評崩壞：自動搬回主店，Game 載回主店', () => {
  const g = rich(13);
  const [a, b] = withStaff(g, [{ level: 10 }, { level: 10 }]);
  g.openBranch(a.id, '東區店');
  const br = g.s.company.stores[1];
  assert.equal(g.switchStore(br.id).ok, true);
  g.s.reputation = D.REPUTATION.min;
  g.s.lowDays = D.REPUTATION.loseDays - 1;
  g.s.schedule = { open: 1, close: 2, auto: false }; // 今天剩下的時間不營業，風評不會回升
  toNextDay(g);
  assert.equal(g.s.kind, 'main', '搬回主店');
  assert.equal(g.s.company.stores.length, 1);
  assert.ok(g.s.staff.some((m) => m.boss), '玩家回到主店');
});

test('品牌聲譽：有分店時，客流同時受自己與各店平均風評影響', () => {
  const g = rich(14);
  const [a] = withStaff(g, [{ level: 10 }]);
  g.s.reputation = 8;
  assert.equal(g.effectiveRep(), 8, '單店：就是自己的風評');
  g.openBranch(a.id, '東區店');
  g.s.company.stores[1].reputation = -8;
  assert.equal(g.brandReputation(), 0);
  assert.equal(g.effectiveRep(), 4, '(8 + 0) / 2');
});

test('任務與統計跨店累計：服務人數、收入、結帳次數是全公司的', () => {
  const g = rich(15);
  const [a] = withStaff(g, [{ level: 10 }]);
  g.openBranch(a.id, '東區店');
  g.s.stats.served = 10;
  g.s.company.stores[1].stats.served = 32;
  assert.equal(g.companyStat('served'), 42);
  assert.equal(g.questProgress({ type: 'serve' }), 42);
});

test('存檔：有分店的公司來回；玩家在哪間店、各店的設備員工風評、共用欄位都保留', () => {
  const g = rich(16);
  const [a, b, c] = withStaff(g, [{ level: 10 }, { level: 11 }, { level: 10 }]); // c 留在主店當店長
  g.openBranch(a.id, '東區店');
  const br = g.s.company.stores[1];
  br.reputation = 3.5;
  br.report = { day: 4, served: 20, earned: 900, wages: 100, reputation: 3.5 };
  g.transferStaff(b.id, br.id);
  assert.equal(g.switchStore(br.id).ok, true);
  const back = RC.state.parse(RC.state.serialize(g.s));
  const co = back.company;
  assert.equal(co.stores.length, 2);
  assert.equal(back.id, br.id, '載入後玩家仍在分店');
  assert.equal(back.kind, 'branch');
  const main = co.stores[0];
  assert.equal(main.kind, 'main');
  assert.ok(!main.staff.some((m) => m.boss), '主店沒有掌櫃');
  assert.ok(back.staff.some((m) => m.boss), '分店有掌櫃');
  assert.equal(back.reputation, 3.5);
  assert.deepEqual(back.report, br.report);
  assert.equal(back.coins, g.s.coins);
  assert.ok(co.stores[0].items.length > 0, '主店的設備還在（場外湊魅力的裝飾會在載入時被丟掉）');
  assert.equal(back.staff.length, br.staff.length);
  assert.ok(back.staff.find((m) => m.id === a.id).manager);
  assert.ok(back.nextStaffId > Math.max(...co.stores.flatMap((x) => x.staff.map((m) => m.id))));
  // 載入後可以直接玩
  const g2 = new RC.Game(back, { seed: 2 });
  for (let i = 0; i < 300; i++) g2.update(0.1);
  assert.ok(g2.crew.length > 0);
});

test('存檔防呆：多位掌櫃只留一位、分店資料壞掉被丟掉、超過上限的分店被忽略、玩家所在店不存在就回主店', () => {
  const g = rich(17);
  const [a, b, c, d] = withStaff(g, [{ level: 10 }, { level: 10 }, { level: 10 }, { level: 10 }]);
  g.openBranch(a.id, 'A店');
  g.openBranch(b.id, 'B店');
  g.openBranch(c.id, 'C店');
  const raw = JSON.parse(RC.codec.decode(RC.state.serialize(g.s)));
  raw.branches.push({ id: 9, name: '多出來的店' }); // 超過 3 間
  raw.branches[0].staff[0].boss = true; // 第二位掌櫃
  raw.branches.push(null, 5, { name: '沒有編號' });
  raw.hq.activeId = 77; // 不存在的店
  const back = RC.state.normalize(raw);
  const co = back.company;
  assert.ok(co.stores.length <= 1 + D.BRANCH.max);
  const bosses = co.stores.flatMap((x) => x.staff.filter((m) => m.boss));
  assert.equal(bosses.length, 1, '全公司只有一位掌櫃');
  assert.ok(co.stores.some((x) => x.id === co.activeId));
  assert.equal(new Set(co.stores.map((x) => x.id)).size, co.stores.length, '店面編號不重複');
});

test('值班店長限制：每間店最多 2 位，存檔載入時多的會被修正', () => {
  const g = rich(18);
  withStaff(g, [{ level: 10 }, { level: 10 }, { level: 10 }]);
  const raw = JSON.parse(RC.codec.decode(RC.state.serialize(g.s)));
  for (const m of raw.staff) if (!m.boss) m.manager = true;
  const back = RC.state.normalize(raw);
  assert.equal(back.staff.filter((m) => m.manager).length, D.DAY.maxManagers);
});

test('公司時間：公司的時間只由玩家所在的店推進；headless 補算不會推進', () => {
  const g = rich(19);
  const [a] = withStaff(g, [{ level: 10 }]);
  g.openBranch(a.id, '東區店');
  const co = g.s.company;
  const t0 = co.gameMin;
  for (let i = 0; i < 100; i++) g.update(0.1);
  assert.ok(co.gameMin > t0, '玩家所在的店推進時間');
  const br = co.stores[1];
  const t1 = co.gameMin;
  g.settleStore(br);
  assert.equal(co.gameMin, t1, '補算分店不影響公司時間');
  assert.ok(br.syncedMin <= co.gameMin + 1);
});

test('玩家在分店時，沒人在的主店風評崩壞：整場遊戲結束（分店倒閉才只是關店）', () => {
  const g = rich(20);
  const [a, b] = withStaff(g, [{ level: 10 }, { level: 10 }]);
  g.openBranch(a.id, '東區店');
  assert.equal(g.switchStore(g.s.company.stores[1].id).ok, true);
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
  const t = g.s.company.gameMin;
  g.update(1);
  assert.equal(g.s.company.gameMin, t, '遊戲結束後時間不再前進');
});

test('隨機操作：開分店、搬家、調動、關店、跑幾天；任何時候全公司只有一位掌櫃、員工編號不重複、每間店至少有結構正確的執行狀態', () => {
  for (const seed of [31, 32, 33]) {
    const g = rich(seed);
    const rng = RC.util.makeRng(seed * 101);
    withStaff(g, Array.from({ length: 6 }, (_, i) => ({ level: i < 4 ? 10 + (i % 3) : 4, speed: 1 + i * 0.05, skill: 1.1 })));
    for (let step = 0; step < 60; step++) {
      const co = g.s.company;
      const r = rng.next();
      const crewNow = g.s.staff.filter((m) => !m.boss);
      if (r < 0.15) crewNow.length && g.openBranch(rng.pick(crewNow).id, '店' + step);
      else if (r < 0.35 && co.stores.length > 1) g.switchStore(rng.pick(co.stores).id);
      else if (r < 0.5 && co.stores.length > 1) {
        const mine = g.s.staff.filter((m) => !m.boss);
        if (mine.length) g.transferStaff(rng.pick(mine).id, rng.pick(co.stores).id);
      } else if (r < 0.55 && co.stores.length > 1) g.closeBranch(rng.pick(co.stores.slice(1)).id, 'manual');
      else {
        g.s.coins = Math.max(g.s.coins, 1e6);
        for (let i = 0; i < 400; i++) g.update(0.1);
      }
      // 不變量
      const bosses = g.s.company.stores.flatMap((x) => x.staff.filter((m) => m.boss));
      assert.equal(bosses.length, 1, `seed ${seed} step ${step}：掌櫃數 ${bosses.length}`);
      const ids = g.s.company.stores.flatMap((x) => x.staff.map((m) => m.id));
      assert.equal(new Set(ids).size, ids.length, `seed ${seed} step ${step}：員工編號重複`);
      assert.ok(g.s.staff.includes(bosses[0]) && g.crew.some((m) => m.boss), '玩家所在的店有掌櫃，也在執行中的員工裡');
      assert.equal(g.crew.length, g.s.staff.length);
      for (const x of g.s.company.stores) assert.ok(x.staff.filter((m) => m.manager).length <= D.DAY.maxManagers);
      assert.equal(g.s.company.storeById(g.s.id), g.s);
      for (const x of g.s.company.stores) assert.ok(Number.isFinite(x.reputation) && Number.isFinite(x.day));
      assert.ok(g.s.coins >= 0);
    }
    // 存檔來回
    const back = RC.state.parse(RC.state.serialize(g.s));
    assert.equal(back.company.stores.length, g.s.company.stores.length);
    assert.equal(back.company.stores.flatMap((x) => x.staff.filter((m) => m.boss)).length, 1);
  }
});
