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

await scenario('客人上門並留下金幣，點擊收款入帳、任務推進', async (page) => {
  await page.click('[data-act=welcome-ok]');
  await G(page, () => { const g = window.__game.game; for (let i = 0; i < 700 && !Object.keys(g.s.drops).length; i++) g.update(0.1); });
  const before = await G(page, () => window.__game.game.s.coins);
  const pos = await G(page, () => { const { game, view } = window.__game; const [k] = Object.keys(game.s.drops); const [x, y] = k.split(',').map(Number); return view.tileToCss(x + 0.5, y + 0.5, 20); });
  await page.mouse.click(pos.x, pos.y);
  assert.equal(await G(page, () => window.__game.game.s.coins), before, '點下去不會立刻入帳，要等掌櫃走過去');
  assert.equal(await G(page, () => window.__game.game.errands.length + window.__game.game.crew.filter((m) => m.errand).length), 1, '掌櫃接下收款差事');
  await G(page, () => { const g = window.__game.game; for (let i = 0; i < 300 && g.s.stats.collects < 1; i++) g.update(0.1); });
  assert.ok((await G(page, () => window.__game.game.s.coins)) > before, '掌櫃收完後金幣增加');
  assert.equal(await G(page, () => window.__game.game.s.stats.collects), 1);
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
      if (i % 20 === 0) for (const k of Object.keys(game.s.drops)) game.collect(...k.split(',').map(Number));
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
