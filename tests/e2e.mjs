// 端對端測試（需要 Playwright）：node tests/e2e.mjs
// 啟動內建靜態伺服器並以子路徑 /web-restaurant-city/ 提供，模擬 GitHub Pages 專案網站的網址結構。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch (e) {
  try {
    ({ chromium } = require('/opt/node22/lib/node_modules/playwright'));
  } catch (e2) {
    console.log('找不到 playwright，略過端對端測試（npm i -D playwright 後可執行）');
    process.exit(0);
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
const BASE = '/web-restaurant-city/';
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith(BASE)) { res.writeHead(404); return res.end('not found'); }
  p = p.slice(BASE.length) || 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}${BASE}`;

const browser = await chromium.launch();
let failed = 0;
async function scenario(name, fn, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  const requests404 = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('response', (r) => r.status() >= 400 && requests404.push(r.status() + ' ' + r.url()));
  try {
    await page.goto(url);
    await page.waitForSelector('#game');
    await fn(page);
    assert.deepEqual(errors, [], '不應有 console/頁面錯誤 ' + JSON.stringify(errors));
    assert.deepEqual(requests404, [], '不應有 404 資源');
    console.log('ok   -', name);
  } catch (e) {
    if (e.done) {
      console.log('ok   -', name);
      await ctx.close();
      return;
    }
    failed++;
    console.log('FAIL -', name, '\n      ', e.message.split('\n')[0]);
  }
  await ctx.close();
}
const G = (page, fn, arg) => page.evaluate(fn, arg);

await scenario('子路徑載入、歡迎視窗、開始營業', async (page) => {
  assert.equal(await page.locator('[data-act=welcome-ok]').count(), 1);
  await page.click('[data-act=welcome-ok]');
  assert.equal(await page.locator('[data-act=welcome-ok]').count(), 0);
  assert.ok((await page.title()).includes('像素餐廳城'));
});

await scenario('餐廳星級最高三星，HUD 以三顆星顯示並隨魅力變化', async (page) => {
  await page.click('[data-act=welcome-ok]');
  const hud = () => page.locator('#stars').innerText();
  assert.ok((await hud()).includes('尚未評星'), await hud());
  assert.equal(await page.locator('#stars .star-row').innerText().then((t) => t.length), 3, '永遠只有三顆星的位置');
  for (const [appeal, word] of [[40, '一星'], [160, '二星'], [400, '三星'], [99999, '三星']]) {
    await G(page, (a) => { const g = window.__game.game; g.appeal = a; g.stars = window.RC.data.starsForAppeal(a); g.changed(); }, appeal);
    await page.waitForTimeout(80);
    const t = await hud();
    assert.ok(t.includes(word), `魅力 ${appeal} 應顯示「${word}」：${t}`);
    assert.ok(!/[4-9]\s*星|10\s*星/.test(t));
  }
});

await scenario('歡迎視窗可為店掌櫃命名；掌櫃不能被開除', async (page) => {
  await page.fill('#bn0', '王老闆');
  await page.click('[data-act=welcome-ok]');
  assert.equal(await G(page, () => window.__game.game.s.staff[0].name), '王老闆');
  await G(page, () => { const g = window.__game.game; g.s.coins = 9999; g.s.level = 3; });
  await page.click('.bottom-bar [data-act=open-staff]');
  assert.ok(await page.locator('.win').innerText().then((t) => t.includes('店掌櫃')));
  assert.ok(await page.locator('.win').innerText().then((t) => t.includes('王老闆')));
  assert.equal(await page.locator('[data-act=fire]').count(), 0, '掌櫃沒有解雇按鈕');
  await page.click('[data-act=boss-rename]');
  await page.fill('#bn2', '小當家');
  await page.click('[data-act=boss-save]');
  assert.equal(await G(page, () => window.__game.game.s.staff[0].name), '小當家');
  assert.ok(await page.locator('.win').innerText().then((t) => t.includes('小當家')), '改名後回到員工面板');
});

await scenario('離線收益：離開 2 小時後重新開啟會看到歡迎回來報告', async (page) => {
  await page.click('[data-act=welcome-ok]');
  // 存一份「2 小時前」的存檔，並停止頁面自己的存檔，免得關閉時被蓋掉
  await G(page, () => {
    window.__game.ui._skipSave = true;
    localStorage.setItem(window.RC.state.SAVE_KEY, window.RC.state.serialize(window.__game.game.s, Date.now() - 2 * 3600 * 1000));
  });
  const ctx = page.context();
  await page.close();
  const p2 = await ctx.newPage();
  const errs = [];
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(url);
  await p2.waitForSelector('#game');
  const txt = await p2.locator('.win').innerText();
  assert.ok(txt.includes('歡迎回來') && txt.includes('2 小時'), txt);
  assert.ok((await p2.evaluate(() => window.__game.game.s.stats.served)) > 10);
  await p2.click('[data-act=lvup-ok]');
  assert.equal(await p2.locator('.win').count(), 0);
  assert.deepEqual(errs, []);
  // scenario() 會對原 page 做檢查，所以把結果頁換成 p2
  await p2.close();
  throw Object.assign(new Error('__done__'), { done: true });
});

await scenario('客人吃完頭上出現金幣，掌櫃走過去結帳，付完客人才離開、座位才釋放', async (page) => {
  await page.click('[data-act=welcome-ok]');
  // 推進到有客人吃完、等結帳
  const info = await G(page, () => {
    const g = window.__game.game;
    for (let i = 0; i < 3000 && !g.customers.some((c) => c.state === 'wait_pay'); i++) g.update(0.1);
    const c = g.customers.find((x) => x.state === 'wait_pay');
    return c ? { id: c.id, seatTaken: g.seatTaken.get(c.seat) === c.id, coins: g.s.coins } : null;
  });
  assert.ok(info, '應該有客人吃完等結帳');
  assert.equal(info.seatTaken, true, '結帳前座位仍被占用');
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'test-results/pay-bubble.png' }).catch(() => {});
  const done = await G(page, (id) => {
    const g = window.__game.game;
    const c = g.customerById(id);
    const seat = c.seat;
    const coins = g.s.coins;
    for (let i = 0; i < 400 && c.state === 'wait_pay'; i++) g.update(0.1);
    return { state: c.state, paid: c.paid, gained: g.s.coins - coins, seatReleased: !g.seatTaken.has(seat), collects: g.s.stats.collects };
  }, info.id);
  assert.equal(done.state, 'leave');
  assert.ok(done.paid > 0 && done.gained >= done.paid, '付款後金幣入帳');
  assert.equal(done.seatReleased, true, '離開時座位釋放');
  assert.ok(done.collects >= 1);
});

await scenario('點擊頭上有金幣的客人：請掌櫃優先結帳', async (page) => {
  await page.click('[data-act=welcome-ok]');
  const pos = await G(page, () => {
    const { game: g, view } = window.__game;
    g.s.coins = 9999; g.s.level = 3; g.hire(0); // 有員工煮菜；掌櫃一直在忙，客人才會留在座位上等結帳
    const busy = () => { g.crew[0].state = 'cooking'; g.crew[0].t = 99; };
    busy();
    for (let i = 0; i < 4000 && !g.customers.some((c) => c.state === 'wait_pay'); i++) { busy(); g.update(0.1); }
    view.render(0.016);
    const c = g.customers.find((x) => x.state === 'wait_pay');
    const p = view.tileToCss(c.x, c.y, 40);
    return { x: p.x, y: p.y, id: c.id };
  });
  await page.mouse.click(pos.x, pos.y);
  assert.equal(await G(page, (id) => window.__game.game.customerById(id).rush, pos.id), true, '點客人會請掌櫃優先');
  assert.ok(await page.locator('#actor').isVisible(), '同時顯示客人資訊卡');
});

await scenario('音效與音樂是兩個獨立的開關，各自有按鈕、音量，並記在存檔裡', async (page) => {
  await page.click('[data-act=welcome-ok]'); // 這次點擊同時解鎖音訊
  const bus = () => G(page, () => { const A = window.RC.audio; return { sfx: A.sfxBus.gain.value, music: A.musicBus.gain.value, sfxOn: A.sfxOn, musicOn: A.musicOn, playing: A.playing, ctx: A.ctx.state }; });
  await page.waitForTimeout(300);
  let b = await bus();
  assert.equal(b.ctx, 'running');
  assert.ok(b.sfxOn && b.musicOn && b.playing, '預設兩者都開、音樂在播');
  assert.ok(b.music > 0.5 && b.sfx > 0.5, '兩條匯流排都有音量');
  assert.equal(await page.locator('#btn-sfx').isVisible() && await page.locator('#btn-music').isVisible(), true, '右上角有兩顆按鈕');

  await page.click('#btn-sfx'); // 只關音效
  await page.waitForTimeout(300);
  b = await bus();
  assert.equal(b.sfxOn, false); assert.equal(b.musicOn, true); assert.equal(b.playing, true, '關音效不影響音樂');
  assert.ok(b.sfx < 0.01 && b.music > 0.5);

  await page.click('#btn-sfx'); // 音效再打開，改關音樂
  await page.click('#btn-music');
  await page.waitForTimeout(400);
  b = await bus();
  assert.equal(b.sfxOn, true); assert.equal(b.musicOn, false); assert.equal(b.playing, false, '音樂停止排程');
  assert.ok(b.music < 0.01 && b.sfx > 0.5, '關音樂不影響音效');

  // 設定面板的滑桿各自獨立
  await page.click('.bottom-bar [data-act=open-settings]');
  await page.evaluate(() => { const el = document.querySelector('[data-vol=music]'); el.value = 30; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const vols = await G(page, () => ({ s: window.RC.audio.sfxVol, m: window.RC.audio.musicVol, saved: window.__game.game.s.settings }));
  assert.equal(vols.m, 0.3); assert.equal(vols.s, 0.8, '調音樂音量不影響音效音量');
  assert.equal(vols.saved.musicVol, 0.3); assert.equal(vols.saved.music, false); assert.equal(vols.saved.sound, true);
  await page.keyboard.press('Escape');

  // 重新載入後設定保持
  await G(page, () => window.RC.state.save(window.__game.game.s));
  await page.reload();
  await page.waitForSelector('#game');
  const after = await G(page, () => { const A = window.RC.audio; return { sfxOn: A.sfxOn, musicOn: A.musicOn, musicVol: A.musicVol }; });
  assert.deepEqual(after, { sfxOn: true, musicOn: false, musicVol: 0.3 });
});

await scenario('暫停按鈕與空白鍵：按下暫停時間凍結，再按繼續；開著設定時自動暫停，關掉後恢復', async (page) => {
  await page.click('[data-act=welcome-ok]');
  await page.waitForTimeout(300);
  const snap = () => G(page, () => { const g = window.__game.game; return JSON.stringify([g.s.stats.playTime, g.s.clock, g.customers.map((c) => [c.x, c.y, c.state]), g.crew.map((m) => [m.x, m.y, m.state])]); });
  assert.equal(await page.locator('#btn-pause').isVisible(), true, 'HUD 有暫停按鈕');
  assert.equal(await page.locator('#pause').isVisible(), false);

  // 1) 按鈕暫停
  await page.click('#btn-pause');
  assert.equal(await G(page, () => window.__game.game.isPausedBy('user')), true);
  assert.equal(await page.locator('#pause').isVisible(), true, '要提示已暫停');
  assert.ok((await page.locator('#pause').innerText()).includes('已暫停'));
  const a = await snap();
  await page.waitForTimeout(1200);
  assert.equal(await snap(), a, '暫停期間任何東西都不動');
  await page.click('#btn-pause');
  assert.equal(await G(page, () => window.__game.game.paused), false);
  await page.waitForTimeout(500);
  assert.notEqual(await snap(), a, '繼續後時間前進');

  // 2) 空白鍵（按完按鈕後仍然有效）
  await page.keyboard.press('Space');
  assert.equal(await G(page, () => window.__game.game.isPausedBy('user')), true);
  await page.keyboard.press('Space');
  assert.equal(await G(page, () => window.__game.game.paused), false);

  // 3) 設定面板：開著就暫停，關掉就繼續
  await page.click('.bottom-bar [data-act=open-settings]');
  assert.equal(await G(page, () => window.__game.game.isPausedBy('settings')), true);
  assert.ok((await page.locator('#pause').innerText()).includes('設定'));
  const b = await snap();
  await page.waitForTimeout(1000);
  assert.equal(await snap(), b, '設定開著時遊戲凍結');
  await page.keyboard.press('Escape');
  assert.equal(await G(page, () => window.__game.game.paused), false);
  await page.waitForTimeout(500);
  assert.notEqual(await snap(), b);

  // 4) 玩家自己按的暫停，不會被「關掉設定」誤解除
  await page.click('#btn-pause');
  await page.click('.bottom-bar [data-act=open-settings]');
  await page.keyboard.press('Escape');
  assert.equal(await G(page, () => window.__game.game.isPausedBy('user')), true, '手動暫停仍然保留');
  assert.equal(await G(page, () => window.__game.game.isPausedBy('settings')), false);
  await page.click('#btn-pause');
});

await scenario('進入裝潢模式時遊戲時間暫停，離開後恢復', async (page) => {
  await page.click('[data-act=welcome-ok]');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#pause').isVisible(), false);
  const snap = () => G(page, () => { const g = window.__game.game; return JSON.stringify([g.s.stats.playTime, g.customers.map((c) => [c.x, c.y, c.state, c.p]), g.crew.map((m) => [m.x, m.y, m.state, m.t]), g.spawnTimer]); });
  await page.click('.bottom-bar [data-act=toggle-edit]');
  assert.equal(await G(page, () => window.__game.game.paused), true);
  assert.equal(await page.locator('#pause').isVisible(), true, '要提示時間已暫停');
  const a = await snap();
  await page.waitForTimeout(1500);
  assert.equal(await snap(), a, '暫停期間（真實過了 1.5 秒）遊戲內任何東西都沒動');
  // 暫停中拖曳擺放照常運作
  await page.click('#editbar [data-act=toggle-edit]');
  assert.equal(await G(page, () => window.__game.game.paused), false);
  assert.equal(await page.locator('#pause').isVisible(), false);
  await page.waitForTimeout(800);
  assert.notEqual(await snap(), a, '離開裝潢模式後時間繼續');
});

await scenario('從商店購買後自動進入擺放（也會暫停時間）', async (page) => {
  await page.click('[data-act=welcome-ok]');
  await G(page, () => { window.__game.game.s.coins = 999; });
  await page.click('.bottom-bar [data-act=open-shop]');
  await page.click('[data-act=buy-furn][data-id=table_wood]');
  assert.equal(await G(page, () => window.__game.game.paused), true);
  await page.keyboard.press('Escape'); // 取消擺放
  await page.keyboard.press('Escape'); // 離開裝潢模式
  assert.equal(await G(page, () => window.__game.game.paused), false);
});

await scenario('商店購買 → 放置預覽 → 點擊擺放', async (page) => {
  await page.click('[data-act=welcome-ok]');
  await page.click('.bottom-bar [data-act=open-shop]');
  await page.click('.tab:has-text("椅子")');
  await page.click('[data-act=buy-furn][data-id=chair_wood]');
  const n0 = await G(page, () => window.__game.game.s.items.length);
  const pos = await G(page, () => window.__game.view.tileToCss(5.5, 6.5, 0));
  await page.mouse.move(pos.x, pos.y);
  assert.equal(await G(page, () => window.__game.view.ghost && window.__game.view.ghost.ok), true);
  await page.mouse.click(pos.x, pos.y);
  assert.equal(await G(page, () => window.__game.game.s.items.length), n0 + 1);
  // 不能疊放
  await G(page, () => window.__game.game.buyFurniture('chair_wood'));
  await page.keyboard.press('Escape');
});

await scenario('員工面板在模擬進行中連點「餵食」不會丟失點擊', async (page) => {
  await page.click('[data-act=welcome-ok]');
  await G(page, () => { const { game } = window.__game; game.s.coins = 9999; game.s.level = 3; game.hire(0); game.speed = 3; });
  const hiredId = await G(page, () => window.__game.game.s.staff.find((m) => !m.boss).id);
  await page.click('.bottom-bar [data-act=open-staff]');
  let fed = 0;
  for (let i = 0; i < 6; i++) {
    await G(page, (id) => { window.__game.game.crewById(id).rec.energy = 5; }, hiredId);
    await page.waitForTimeout(120 + i * 70); // 讓面板定時更新在不同時間點發生
    const c0 = await G(page, () => window.__game.game.s.coins);
    await page.click(`[data-act=feed][data-id="${hiredId}"]`);
    const c1 = await G(page, () => window.__game.game.s.coins);
    if (c1 < c0) fed++;
  }
  assert.equal(fed, 6, '6 次點擊都應生效，實際 ' + fed);
});

await scenario('編輯模式：選取、旋轉、收起、倉庫放回；存檔重載後一致', async (page) => {
  await page.click('[data-act=welcome-ok]');
  await page.click('.bottom-bar [data-act=toggle-edit]');
  const pos = await G(page, () => window.__game.view.tileToCss(7.5, 0.5, 14));
  await page.mouse.click(pos.x, pos.y);
  assert.ok((await G(page, () => window.__game.view.selectedItem)) != null, '應選到盆栽');
  await page.click('[data-act=item-store]');
  assert.equal(await G(page, () => window.__game.game.s.inventory.plant_pot), 1);
  await G(page, () => window.RC.state.save(window.__game.game.s));
  await page.reload();
  await page.waitForSelector('#game');
  assert.equal(await G(page, () => window.__game.game.s.inventory.plant_pot), 1);
  assert.equal(await page.locator('[data-act=welcome-ok]').count(), 0, '重載後不應再顯示歡迎視窗');
});

await scenario('裝潢模式是上視圖：格子為正方形、點格子選到家具、可以拖曳到另一格；離開後回到等角視角', async (page) => {
  await page.click('[data-act=welcome-ok]');
  assert.equal(await G(page, () => window.__game.view.top), false, '平常是等角視角');
  await page.click('.bottom-bar [data-act=toggle-edit]');
  assert.equal(await G(page, () => window.__game.view.top), true, '裝潢模式是上視圖');
  // 上視圖：相鄰格在水平／垂直方向各差一個格寬，沒有斜向位移
  const geo = await G(page, () => { const v = window.__game.view; const a = v.proj(2, 2); const b = v.proj(3, 2); const c = v.proj(2, 3); return [b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]]; });
  assert.deepEqual(geo, [16, 0, 0, 16]);
  // 點擊格子 → 反推回同一格
  const tile = await G(page, () => { const v = window.__game.view; const p = v.tileToCss(6.5, 3.5); return v.tileAt(p.x, p.y); });
  assert.deepEqual(tile, { x: 6, y: 3 });
  // 選取起始的盆栽（7,0）後拖到空格 (7,1)
  const from = await G(page, () => window.__game.view.tileToCss(7.5, 0.5));
  const to = await G(page, () => window.__game.view.tileToCss(7.5, 1.5));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  const moved = await G(page, () => window.__game.game.s.items.find((i) => i.id === 'plant_pot'));
  assert.deepEqual([moved.x, moved.y], [7, 1], '拖曳後盆栽移到新的格子');
  await page.click('.edit-bar [data-act=toggle-edit]');
  assert.equal(await G(page, () => window.__game.view.top), false, '離開後恢復等角視角');
  assert.equal(await G(page, () => window.__game.view.edit), false);
});

await scenario('以 3 倍速連續模擬 20 分鐘不出錯，等級成長', async (page) => {
  await page.click('[data-act=welcome-ok]');
  await G(page, () => {
    const { game } = window.__game;
    // 有日夜與排班之後，只靠店掌櫃一人撐不住不斷增加的座位：先請兩位員工
    game.s.coins = 1e5; game.s.level = 12; game.hire(0); game.hire(0); game.setAutoSchedule(true);
    for (let i = 0; i < 12000; i++) {
      game.update(0.1);
      if (i % 100 === 0) { game.claimQuest(); game.s.coins = Math.max(game.s.coins, 1e4); game.buyFurniture('chair_wood'); }
    }
  });
  await page.waitForTimeout(300);
  assert.ok((await G(page, () => window.__game.game.s.stats.served)) > 50);
});

await scenario('存檔版次比目前新：不讀取，顯示只能重新開局，舊存檔備份且不被覆蓋；按下「開始新遊戲」才進入新局', async (page) => {
  const text = await G(page, () => {
    const RC = window.RC;
    const raw = JSON.parse(RC.codec.decode(RC.state.serialize(RC.state.newGame())));
    raw.v = RC.data.GAME_VERSION.current + 3;
    raw.coins = 424242;
    const t = RC.codec.encode(JSON.stringify(raw));
    window.__game.ui._skipSave = true;
    localStorage.setItem(RC.state.SAVE_KEY, t);
    return t;
  });
  const ctx = page.context();
  await page.close();
  const p2 = await ctx.newPage();
  const errs = [];
  p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(url);
  await p2.waitForSelector('#game');
  const txt = await p2.locator('.win').innerText();
  assert.ok(txt.includes('版次不相容') && txt.includes('版次 ' + (await p2.evaluate(() => window.RC.data.GAME_VERSION.current + 3))), txt);
  assert.ok((await p2.evaluate(() => window.__game.game.s.coins)) !== 424242, '不應載入不相容的存檔');
  await p2.waitForTimeout(300);
  assert.equal(await p2.evaluate(() => localStorage.getItem(window.RC.state.SAVE_KEY + '/incompatible-backup')), text, '舊存檔要備份');
  assert.equal(await p2.evaluate(() => localStorage.getItem(window.RC.state.SAVE_KEY)), text, '在玩家決定前不能蓋掉原存檔');
  await p2.click('[data-act=version-new]');
  assert.ok((await p2.locator('.win').innerText()).includes('歡迎來到'));
  assert.deepEqual(errs, []);
  await p2.close();
  throw Object.assign(new Error('__done__'), { done: true });
});

await scenario('排班：營業時間、手動排班（每班 8 小時）、自動排班、值班店長；HUD 顯示天數與風評', async (page) => {
  await page.click('[data-act=welcome-ok]');
  const hud = await page.locator('#clock').innerText();
  assert.ok(/第 1 天 \d\d:\d\d/.test(hud) && hud.includes('風評'), hud);
  await G(page, () => { const g = window.__game.game; g.s.coins = 1e5; g.s.level = 12; g.hire(0); g.s.staff[1].level = 10; });
  await page.click('.bottom-bar [data-act=open-staff]');
  assert.ok(await page.locator('[data-act=set-manager]').count() >= 1, 'Lv.10 以上的員工可任命值班店長');
  await page.click('[data-act=set-manager]');
  assert.equal(await G(page, () => window.__game.game.s.staff.filter((m) => m.manager).length), 1);
  await page.click('[data-tab=sched]');
  assert.ok((await page.locator('.win-body').innerText()).includes('每天排定上班 8 小時') && (await page.locator('.win-body').innerText()).includes('留下來收店'));
  await page.selectOption('[data-sel=open]', '10');
  await page.selectOption('[data-sel=close]', '20');
  assert.deepEqual(await G(page, () => { const s = window.__game.game.s.schedule; return [s.open, s.close]; }), [10, 20]);
  await page.click('[data-act=auto-sched]'); // 關掉自動排班
  assert.equal(await G(page, () => window.__game.game.s.schedule.auto), false);
  await page.selectOption('[data-sel=shift] >> nth=1', '14');
  assert.equal(await G(page, () => window.__game.game.s.staff[1].shift), 14);
  const bars = await G(page, () => window.__game.game.coverage().staff.reduce((a, b) => a + b, 0));
  assert.equal(bars, 2 * 8, '兩個人、每人 8 小時');
  const w = await G(page, () => { const b = document.querySelector('.win-body'); return b.scrollWidth - b.clientWidth; });
  assert.ok(w <= 0, '排班頁不應出現水平捲軸');
});

await scenario('招聘獨立分頁：雇用不扣金幣、顯示日薪；員工分頁顯示日薪與欠薪；午夜發薪', async (page) => {
  await page.click('[data-act=welcome-ok]');
  await G(page, () => { const g = window.__game.game; g.s.coins = 5000; g.s.level = 5; });
  await page.click('.bottom-bar [data-act=open-staff]');
  const tabs = await page.locator('.tabs .tab').allInnerTexts();
  assert.deepEqual(tabs, ['員工', '招聘', '排班']);
  assert.equal(await page.locator('[data-act=hire]').count(), 0, '員工分頁不再放應徵者');
  await page.click('[data-tab=hire]');
  assert.equal(await page.locator('[data-act=hire]').count(), 3);
  const txt = await page.locator('.win-body').innerText();
  assert.ok(txt.includes('日薪') && txt.includes('不用先付錢'), txt);
  await page.click('[data-act=hire] >> nth=0');
  assert.equal(await G(page, () => window.__game.game.s.coins), 5000, '雇用不扣金幣');
  assert.equal(await G(page, () => window.__game.game.s.staff.length), 2);
  assert.ok((await G(page, () => window.__game.game.s.staff[1].wage)) > 0);
  await page.click('[data-tab=crew]');
  assert.ok((await page.locator('.win-body').innerText()).includes('日薪'), '員工分頁顯示日薪');
  // 午夜發薪
  const wage = await G(page, () => window.__game.game.s.staff[1].wage);
  const before = await G(page, () => { const g = window.__game; g.game.setBusinessHours(1, 2); g.game.s.clock = 1439.9; return g.game.s.coins; });
  await page.waitForFunction(() => window.__game.game.s.day >= 2, null, { timeout: 8000 });
  const after = await G(page, () => window.__game.game.s.coins);
  assert.ok(before - after >= wage - 5 && before - after <= wage + 5, `應扣一天日薪 ${wage}：${before} → ${after}`);
});

await scenario('客流尖峰／離峰：HUD 顯示時段，排班頁有客流圖與尖峰時段', async (page) => {
  await page.click('[data-act=welcome-ok]');
  await G(page, () => { window.__game.game.s.clock = 12.5 * 60; });
  await page.waitForFunction(() => document.querySelector('#clock').textContent.includes('尖峰'), null, { timeout: 4000 });
  await G(page, () => { window.__game.game.s.clock = 15.5 * 60; });
  await page.waitForFunction(() => document.querySelector('#clock').textContent.includes('離峰'), null, { timeout: 4000 });
  await page.click('.bottom-bar [data-act=open-staff]');
  await page.click('[data-tab=sched]');
  const txt = await page.locator('.win-body').innerText();
  assert.ok(txt.includes('客人上門的頻率') && txt.includes('尖峰時段：12:00–14:00、18:00–20:00'), txt);
  assert.equal(await page.locator('.h24 i[title*="客流"]').count(), 24);
});

await scenario('風評連續 15 天谷底：遊戲終止並顯示重新開始視窗；重新開始會清掉存檔', async (page) => {
  await page.click('[data-act=welcome-ok]');
  await G(page, () => { const g = window.__game.game; g.s.reputation = -10; g.s.lowDays = 14; g.s.clock = 1439.5; });
  await page.waitForSelector('[data-act=restart]', { timeout: 8000 });
  assert.ok((await page.locator('.win').innerText()).includes('倒閉'));
  assert.ok(await G(page, () => !!window.__game.game.s.over));
  const before = await G(page, () => window.__game.game.s.stats.playTime);
  await page.waitForTimeout(500);
  assert.equal(await G(page, () => window.__game.game.s.stats.playTime), before, '遊戲終止後時間不再前進');
  await page.click('[data-act=restart]');
  await page.waitForSelector('[data-act=welcome-ok]');
  assert.equal(await G(page, () => !!window.__game.game.s.over), false);
});

await scenario('手機尺寸（觸控）可操作並維持版面', async (page) => {
  await page.click('[data-act=welcome-ok]');
  await page.tap('.bottom-bar [data-act=open-menu]');
  assert.ok(await page.locator('.win').isVisible());
  const box = await page.locator('.win').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390 + 1, '視窗不應超出螢幕寬度');
  const overflow = await G(page, () => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, '頁面不應出現水平捲動');
}, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });

await scenario('窄視窗（或文字放大）時，升級視窗與各面板都不出現水平捲軸', async (page) => {
  await page.click('[data-act=welcome-ok]');
  const overflow = () => G(page, () => {
    const b = document.querySelector('.win-body');
    return Math.max(b ? b.scrollWidth - b.clientWidth : 0, document.documentElement.scrollWidth - window.innerWidth);
  });
  // 升級視窗的標題有跳動動畫，要在動畫的不同時間點量測
  await G(page, () => { const g = window.__game.game; g.s.level = 9; g.addXp(window.RC.data.xpForLevel(9)); });
  await page.waitForSelector('[data-act=lvup-ok]');
  for (let i = 0; i < 10; i++) {
    assert.equal(await overflow(), 0, '升級視窗第 ' + i + ' 次量測有水平溢出');
    await page.waitForTimeout(70);
  }
  await page.click('[data-act=lvup-ok]');
  for (const nav of ['open-shop', 'open-menu', 'open-staff', 'open-quest', 'open-settings']) {
    await page.click(`.bottom-bar [data-act=${nav}]`);
    assert.equal(await overflow(), 0, nav + ' 面板有水平溢出');
    await page.keyboard.press('Escape');
  }
}, { viewport: { width: 330, height: 520 } });

await browser.close();
server.close();
console.log(failed ? `\n${failed} 個情境失敗` : '\n全部端對端情境通過');
process.exit(failed ? 1 : 0);
