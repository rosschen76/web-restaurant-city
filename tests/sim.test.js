'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;

const mk = (seed = 1, mut) => {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  if (mut) mut(s);
  return new RC.Game(s, { seed, dayMode: false });
};
const run = (g, sec, dt = 0.05) => {
  for (let t = 0; t < sec; t += dt) g.update(dt);
};

test('初始版面：有座位、有爐灶、門口可通行', () => {
  const g = mk();
  assert.equal(g.seats.length, 4);
  assert.equal(g.tables.size, 2);
  assert.equal(g.maxTableCap, 2);
  assert.equal(g.stoves.length, 1);
  assert.ok(g.grid.reach[D.DOOR_Y * g.grid.w + 0]);
});

test('A* 繞開障礙，並可走到被擋住的終點格', () => {
  const g = mk();
  const p = RC.world.findPath(g.grid, 0, 3, 7, 7);
  assert.ok(p && p.length === 11);
  const seat = g.seats[0];
  const q = RC.world.findPath(g.grid, 0, 3, seat.x, seat.y);
  assert.ok(q && q[q.length - 1].x === seat.x);
});

test('擺放檢查：重疊、越界、門口都會被拒絕', () => {
  const g = mk();
  const def = D.furniture.table_wood;
  assert.equal(RC.world.canPlace(g.grid, def, 3, 4, 0).ok, false); // 已有桌子
  assert.equal(RC.world.canPlace(g.grid, def, 8, 0, 0).ok, false); // 越界
  assert.equal(RC.world.canPlace(g.grid, def, 1, D.DOOR_Y, 0).ok, false); // 門口
  assert.equal(RC.world.canPlace(g.grid, D.furniture.table_long, 7, 7, 0).ok, false); // 2 格超出
  assert.equal(RC.world.canPlace(g.grid, def, 6, 6, 0).ok, true);
});

test('完整營運循環：客人入座 → 點餐 → 烹飪 → 上菜 → 付款 → 離開', () => {
  const g = mk(7);
  const served = [];
  g.on('served', () => served.push(1));
  run(g, 120);
  assert.ok(g.s.stats.served >= 3, '應該至少服務 3 位，實際 ' + g.s.stats.served);
  assert.ok(g.s.stats.earned > 0, '客人付款後金幣入帳');
  assert.ok(g.s.stats.collects >= 3, '掌櫃結了至少 3 次帳');
  assert.ok(g.s.dishes.danbing.cooked >= 3);
  assert.equal(served.length, g.s.stats.served);
});

test('結帳入帳：金幣只在客人付款時增加，且與累計收入一致', () => {
  const g = mk(7);
  const start = g.s.coins;
  run(g, 90);
  assert.ok(g.s.stats.earned > 0);
  assert.equal(g.s.coins - start - g.s.stats.earned - levelRewards(g), 0, '金幣增量 = 累計收入 + 升級獎勵');
});

function levelRewards(g) {
  let r = 0;
  for (let lv = 2; lv <= g.s.level; lv++) r += D.levelReward(lv);
  return r;
}

test('收銀機：客人吃完自助結帳，不必等掌櫃', () => {
  const g = mk(7, (s) => s.items.push({ uid: 99, id: 'register', x: 7, y: 7, rot: 0 }));
  let maxWait = 0;
  for (let t = 0; t < 120; t += 0.1) {
    g.update(0.1);
    for (const c of g.customers) if (c.state === 'wait_pay') maxWait = Math.max(maxWait, c.payWait);
  }
  assert.ok(g.s.stats.earned > 0);
  assert.ok(maxWait <= 1.7, '有收銀機最多等 ' + maxWait.toFixed(2) + ' 秒');
});

test('沒有員工來點餐時客人會生氣離開，且釋放座位', () => {
  const g = mk(3);
  g.crew.forEach((m) => (m.rec.energy = 0)); // 員工都累癱
  g.crew.forEach((m) => (m.state = 'rest'));
  g.update(0.01);
  g.crew.forEach((m) => (m.rec.energy = 0));
  run(g, 25);
  // 強制不讓員工恢復
  g.crew.forEach((m) => { m.rec.energy = 0; m.state = 'rest'; });
  for (let i = 0; i < 700; i++) { g.crew.forEach((m) => { m.rec.energy = 0; m.state = 'rest'; }); g.update(0.1); }
  assert.ok(g.s.stats.angry >= 1);
  assert.ok(g.seatTaken.size <= g.seats.length);
});

test('移動家具時工作會被安全中止，客人不會卡死', () => {
  const g = mk(5);
  run(g, 20);
  const stove = g.s.items.find((i) => i.id === 'stove_gas');
  assert.equal(g.moveItem(stove.uid, 6, 0, 0).ok, true);
  for (const table of g.s.items.filter((i) => i.id === 'table_wood')) assert.equal(g.storeItem(table.uid).ok, true); // 沒桌子 → 沒座位
  assert.equal(g.seats.length, 0);
  run(g, 20);
  assert.equal(g.customers.length, 0, '所有客人都該離開');
  assert.equal(g.seatTaken.size, 0);
  assert.equal(g.stoveBusy.size, 0);
});

test('購買/擺放/出售流程與金幣', () => {
  const g = mk();
  assert.equal(g.buyFurniture('chair_wood').ok, true);
  assert.equal(g.s.coins, 300 - 45);
  assert.equal(g.placeFromInventory('chair_wood', 3, 5, 0).ok, true);
  assert.equal(g.seats.length, 5); // (3,5) 夾在兩張桌子之間，只算一個座位
  assert.equal(g.placeFromInventory('chair_wood', 3, 5, 0).ok, false);
  assert.equal(g.buyFurniture('piano').ok, false); // 等級不夠
  const it = g.s.items.find((i) => i.x === 3 && i.y === 5);
  assert.equal(g.sellItem(it.uid).ok, true);
  assert.equal(g.s.coins, 300 - 45 + 22);
});

test('升級發放獎勵並回報解鎖內容', () => {
  const g = mk();
  let info = null;
  g.on('levelup', (e) => (info = e));
  g.addXp(D.xpForLevel(1));
  assert.equal(g.s.level, 2);
  assert.ok(info && info.reward === D.levelReward(2));
  assert.ok(info.unlocks.dishes.some((d) => d.id === 'fantuan'));
});

test('學菜、雇人、擴建的限制', () => {
  const g = mk();
  assert.equal(g.learnDish('soymilk').ok, true);
  assert.equal(g.learnDish('soymilk').ok, false);
  assert.equal(g.learnDish('fantuan').ok, false); // 2 級
  g.s.coins = 100000;
  g.s.level = 2;
  assert.equal(g.hire(0).ok, true);
  assert.equal(g.s.staff.length, 2);
  assert.equal(g.hire(0).ok, true); // 掌櫃不佔名額：2 級可雇 2 位
  assert.equal(g.hire(0).ok, false); // 第 3 位超過上限
  assert.equal(g.expand().ok, false); // 3 級才可擴建
  g.s.level = 3;
  assert.equal(g.expand().ok, true);
  assert.equal(g.grid.w, 10);
});

test('任務依序推進', () => {
  const g = mk(7);
  let cur = g.currentQuest();
  assert.equal(cur.q.id, 'q1');
  assert.equal(g.claimQuest().ok, false);
  for (let i = 0; i < 80 && !g.currentQuest().done; i++) run(g, 5);
  assert.equal(g.currentQuest().done, true, '掌櫃結帳 3 次後任務完成');
  assert.equal(g.claimQuest().ok, true);
  assert.equal(g.currentQuest().q.id, 'q2');
});

test('存檔往返與壞資料修復', () => {
  const g = mk(7);
  run(g, 30);
  const text = RC.state.serialize(g.s);
  const back = RC.state.parse(text);
  assert.deepEqual(back.items, g.s.items);
  assert.equal(back.coins, g.s.coins);
  assert.equal(back.staff.length, g.s.staff.length);
  const bad = RC.state.normalize({ coins: 'x', items: [{ id: 'nope', x: 1, y: 1 }, { id: 'table_wood', x: 99, y: 0 }, { id: 'table_wood', x: 2, y: 2 }, { id: 'table_wood', x: 2, y: 2 }], level: 9999 });
  assert.equal(bad.items.filter((i) => i.id !== 'sink').length, 1);
  assert.equal(bad.items.filter((i) => i.id === 'sink').length, 1, '沒有洗碗槽的舊存檔會自動補一個');
  assert.equal(bad.flags.addedSink, true);
  assert.equal(bad.level, D.MAX_LEVEL);
  assert.ok(Number.isFinite(bad.coins));
  assert.equal(RC.state.load({ getItem: () => '{oops' }), null);
});

test('經濟平衡：自動玩 20 分鐘（有結帳、會買東西、會洗碗）能順利成長', () => {
  const g = mk(11);
  const W = RC.world;
  /** 小心的玩家：擺完確認爐灶、洗碗槽、座位都還能用，否則收回去換位置 */
  const placeSafe = (ids, spots) => {
    const before = { st: g.stoves.length, sk: g.sinks.length, se: g.seats.length };
    for (const spot of spots) {
      const placed = [];
      let ok = true;
      for (const [id, x, y, rot] of spot) {
        if (!(g.s.inventory[id] > 0)) { g.buyFurniture(id); }
        const r = g.placeFromInventory(id, x, y, rot || 0);
        if (!r.ok) { ok = false; break; }
        placed.push(g.s.items[g.s.items.length - 1].uid);
      }
      if (ok && g.stoves.length >= before.st && g.sinks.length >= before.sk && g.seats.length >= before.se) return true;
      for (const uid of placed) g.storeItem(uid);
    }
    return false;
  };
  const freeTiles = () => {
    const out = [];
    for (let y = 0; y < g.grid.h; y++) for (let x = g.grid.w - 1; x >= 0; x--) if (!g.grid.occ[y * g.grid.w + x] && !(y === D.DOOR_Y && x <= 1)) out.push([x, y]);
    return out;
  };
  let t = 0;
  let blockUntil = 0;
  // 擺不下就先放棄一陣子：反覆「放下又收回」會一直重算版面，把正在入座的客人趕走（真實遊戲裡裝潢時時間是暫停的）
  const tryPlace = (ids, spots) => {
    if (t < blockUntil) return;
    if (!placeSafe(ids, spots)) blockUntil = t + 40;
  };
  const log = [];
  while (t < 1200) {
    g.update(0.1);
    t += 0.1;
    if (Math.floor(t * 10) % 20 === 0) {
      const s = g.s;
      const cur = g.currentQuest();
      if (cur && cur.done) g.claimQuest();
      if (s.coins >= 400 && s.staff.length - 1 < D.maxStaffForLevel(s.level) && s.candidates[0]) g.hire(0);
      else if (g.stoves.length < Math.ceil(s.staff.length * 0.8) && s.coins >= 150) tryPlace(['stove_gas'], freeTiles().map(([x, y]) => [['stove_gas', x, y]]));
      else if (g.sinks.length < Math.ceil(s.staff.length / 3) && s.coins >= 300) tryPlace(['sink'], freeTiles().map(([x, y]) => [['sink', x, y]]));
      else if (g.stoves.length >= Math.ceil(s.staff.length * 0.8) && g.seats.length < s.staff.length * 4 + 2 && s.coins >= 105) {
        const spots = [];
        for (const [x, y] of freeTiles()) spots.push([['table_wood', x, y], ['chair_stool', x - 1, y], ['chair_stool', x + 1, y, 2]]);
        tryPlace(['table_wood'], spots);
      }
      if (s.level >= 2 && !s.dishes.fantuan && s.coins >= 150) g.learnDish('fantuan');
      if (s.level >= 3 && !s.dishes.luroufan && s.coins >= 400) g.learnDish('luroufan');
    }
    if (Math.floor(t) % 300 === 0 && Math.abs(t - Math.round(t)) < 0.05) log.push([Math.round(t), g.s.level, g.s.coins, g.s.stats.served, g.s.staff.length, g.seats.length, g.stoves.length, g.sinks.length, g.s.stats.angry, g.customers.length]);
  }
  console.log('  [t, lv, coins, served, staff, seats, stoves, sinks, angry, cust]', JSON.stringify(log));
  assert.ok(g.s.stats.served >= 90, '20 分鐘至少服務 90 位，實際 ' + g.s.stats.served);
  assert.ok(g.s.level >= 4, '20 分鐘應至少 4 級，實際 ' + g.s.level);
});

test('存檔編碼：來回一致、每次輸出不同、看不到明文', () => {
  const g = mk(7);
  run(g, 20);
  const a = RC.state.serialize(g.s);
  const b = RC.state.serialize(g.s);
  assert.ok(a.startsWith(RC.codec.PREFIX));
  assert.notEqual(a, b, '同一份存檔每次編碼都不同');
  for (const word of ['coins', 'level', 'items', '阿福', 'table_wood']) assert.ok(!a.includes(word), '不應出現明文 ' + word);
  const back = RC.state.parse(a);
  assert.equal(back.coins, g.s.coins);
  assert.deepEqual(back.items, g.s.items);
  assert.equal(back.staff[0].name, g.s.staff[0].name);
  assert.equal(RC.state.parse(b).coins, g.s.coins);
});

test('存檔編碼：中文、特殊字元與大檔案都能來回', () => {
  const g = mk(1);
  g.s.name = '我的店😀';
  g.s.coins = 123456789;
  g.s.staff[0].name = '王老闆';
  const back = RC.state.parse(RC.state.serialize(g.s));
  assert.equal(back.name, '我的店😀'.slice(0, 12));
  assert.equal(back.staff[0].name, '王老闆');
  const text = 'x'.repeat(200000) + '中文';
  assert.equal(RC.codec.decode(RC.codec.encode(text)), text);
  assert.equal(RC.codec.decode(RC.codec.encode('')), '');
});

test('存檔編碼：被改動、截斷、換行貼上與明文 JSON 的處理', () => {
  const g = mk(2);
  const enc = RC.state.serialize(g.s);
  // 任何一個字元被改掉都解不開（抽樣多個位置，每個位置換成另一個合法 base64 字元）
  const body = enc.slice(RC.codec.PREFIX.length);
  let rejected = 0;
  for (let i = 0; i < body.length; i += Math.max(1, Math.floor(body.length / 60))) {
    const c = body[i] === 'A' ? 'B' : 'A';
    const bad = RC.codec.PREFIX + body.slice(0, i) + c + body.slice(i + 1);
    assert.throws(() => RC.state.parse(bad), undefined, '位置 ' + i + ' 被改動應該被拒絕');
    rejected++;
  }
  assert.ok(rejected >= 50);
  assert.throws(() => RC.state.parse(enc.slice(0, enc.length - 8)), '截斷');
  assert.throws(() => RC.state.parse(''), '空字串');
  assert.throws(() => RC.state.parse(JSON.stringify(g.s)), '匯入明文 JSON 不被接受');
  assert.throws(() => RC.state.parse('PRC1:!!!!'), '亂碼');
  // 貼上時自動換行/空白不影響
  const wrapped = enc.replace(/(.{40})/g, '$1\n  ');
  assert.equal(RC.state.parse(wrapped).coins, g.s.coins);
});

test('讀檔：舊版明文存檔相容；被改過的存檔備份後重新開始', () => {
  const store = {};
  const storage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => (store[k] = v), removeItem: (k) => delete store[k] };
  const g = mk(3);
  g.s.coins = 777;
  // 新格式
  assert.equal(RC.state.save(g.s, storage), true);
  assert.ok(store[RC.state.SAVE_KEY].startsWith(RC.codec.PREFIX));
  assert.equal(RC.state.load(storage).coins, 777);
  assert.equal(RC.state.loadStatus, 'ok');
  // 舊版明文
  store[RC.state.SAVE_KEY] = JSON.stringify(g.s);
  assert.equal(RC.state.load(storage).coins, 777);
  // 玩家改了存檔內容
  const good = RC.state.serialize(g.s);
  const tampered = good.slice(0, 20) + (good[20] === 'A' ? 'B' : 'A') + good.slice(21);
  store[RC.state.SAVE_KEY] = tampered;
  assert.equal(RC.state.load(storage), null);
  assert.equal(RC.state.loadStatus, 'corrupt');
  assert.equal(store[RC.state.SAVE_KEY + '/corrupt-backup'], tampered, '壞存檔要備份');
  // 沒有存檔
  delete store[RC.state.SAVE_KEY];
  assert.equal(RC.state.load(storage), null);
  assert.equal(RC.state.loadStatus, 'none');
});

test('地毯已取消：商品、分類、特殊「可穿越」屬性都不存在，所有家具都佔住格子', () => {
  assert.ok(!D.furnitureList.some((f) => f.id.startsWith('rug') || f.cat === 'rug' || f.flat));
  assert.ok(!D.FURNITURE_CATS.some((c) => c.id === 'rug'));
  for (const def of D.furnitureList) {
    const s = RC.state.newGame(RC.util.makeRng(1));
    s.items = [{ uid: 1, id: def.id, x: 5, y: 5, rot: 0 }];
    const g = new RC.Game(s, { seed: 1, dayMode: false });
    assert.equal(g.grid.blocked[5 * g.grid.w + 5], 1, def.id + ' 應該佔住格子');
  }
});

test('舊存檔裡的地毯（擺放中與倉庫）載入時按原價退款，並從存檔移除', () => {
  const raw = JSON.parse(JSON.stringify(RC.state.newGame(RC.util.makeRng(1))));
  raw.coins = 1000;
  const keep = raw.items.length;
  raw.items.push({ uid: 90, id: 'rug_red', x: 1, y: 1, rot: 0 }, { uid: 91, id: 'rug_blue', x: 1, y: 2, rot: 0 });
  raw.inventory = { rug_tatami: 2, chair_wood: 1 };
  const back = RC.state.normalize(raw);
  assert.equal(back.coins, 1000 + 90 + 400 + 150 * 2);
  assert.equal(back.items.length, keep, '地毯不再出現在餐廳裡');
  assert.deepEqual(back.inventory, { chair_wood: 1 }, '倉庫只留下仍存在的商品');
  // 再存一次、再讀一次，不會重複退款
  const again = RC.state.parse(RC.state.serialize(back));
  assert.equal(again.coins, back.coins);
});

test('任務文字不再提到地毯，裝飾任務只算裝飾', () => {
  assert.ok(!D.quests.some((q) => q.text.includes('地毯')));
  const g = mk(1);
  const before = g.questProgress({ type: 'decor' });
  g.s.coins = 1e5;
  g.buyFurniture('plant_pot');
  g.placeFromInventory('plant_pot', 6, 6, 0);
  assert.equal(g.questProgress({ type: 'decor' }), before + 1);
});

test('餐廳星級仿米其林：最高三星，0 星代表尚未評星', () => {
  assert.equal(D.MAX_STARS, 3);
  assert.equal(D.STAR_TITLES.length, 4);
  assert.equal(D.starsForAppeal(0), 0);
  assert.equal(D.starsForAppeal(39), 0);
  assert.equal(D.starsForAppeal(40), 1);
  assert.equal(D.starsForAppeal(159), 1);
  assert.equal(D.starsForAppeal(160), 2);
  assert.equal(D.starsForAppeal(399), 2);
  assert.equal(D.starsForAppeal(400), 3);
  assert.equal(D.starsForAppeal(1e9), 3, '再多魅力也不會超過三星');
  assert.equal(D.nextStarAppeal(0), 40);
  assert.equal(D.nextStarAppeal(2), 400);
  assert.equal(D.nextStarAppeal(3), null);
  // 起始餐廳尚未評星；任務裡沒有超過三星的目標
  assert.equal(mk().stars, 0);
  for (const q of D.quests) if (q.type === 'stars') assert.ok(q.n >= 1 && q.n <= 3, q.text);
  assert.ok(!D.quests.some((q) => /[4-9]\s*星|10\s*星/.test(q.text)));
});

test('星級影響售價：每顆星 +10%，0 星不加成也不打折', () => {
  const g = mk();
  const base = D.dishes.danbing.price;
  assert.equal(g.stars, 0);
  assert.equal(g.dishInfo('danbing').price, base);
  g.stars = 3;
  assert.equal(g.dishInfo('danbing').price, Math.round(base * 1.3));
});

test('暫停原因可以疊加：玩家暫停、裝潢、設定各自獨立，全部解除才會繼續', () => {
  const g = mk(7);
  run(g, 5);
  const t0 = g.s.stats.playTime;
  g.setPause('user', true);
  g.setPause('settings', true);
  g.setPause('edit', true);
  assert.equal(g.paused, true);
  run(g, 10);
  assert.equal(g.s.stats.playTime, t0, '暫停中時間不流動');
  g.setPause('settings', false); // 關掉設定
  assert.equal(g.paused, true, '玩家自己按的暫停還在');
  g.setPause('edit', false);
  assert.equal(g.paused, true);
  assert.equal(g.catchUp(7200), null, '暫停中不做離線補算');
  g.setPause('user', false);
  assert.equal(g.paused, false);
  run(g, 5);
  assert.ok(g.s.stats.playTime > t0);
  // 相容寫法
  g.paused = true;
  assert.equal(g.isPausedBy('user'), true);
  g.paused = false;
  assert.equal(g.paused, false);
});
