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
    assert.deepEqual(errors, [], '不應有 console/頁面錯誤');
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

await scenario('以 3 倍速連續模擬 20 分鐘不出錯，等級成長', async (page) => {
  await page.click('[data-act=welcome-ok]');
  await G(page, () => {
    const { game } = window.__game;
    for (let i = 0; i < 12000; i++) {
      game.update(0.1);
      if (i % 100 === 0) { game.claimQuest(); game.buyFurniture('chair_wood'); }
    }
  });
  await page.waitForTimeout(300);
  assert.ok((await G(page, () => window.__game.game.s.stats.served)) > 50);
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
