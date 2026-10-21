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

await scenario('客人上門並留下金幣，點擊收款入帳、任務推進', async (page) => {
  await page.click('[data-act=welcome-ok]');
  await G(page, () => { const g = window.__game.game; for (let i = 0; i < 700 && !Object.keys(g.s.drops).length; i++) g.update(0.1); });
  const before = await G(page, () => window.__game.game.s.coins);
  const pos = await G(page, () => { const { game, view } = window.__game; const [k] = Object.keys(game.s.drops); const [x, y] = k.split(',').map(Number); return view.tileToCss(x + 0.5, y + 0.5, 20); });
  await page.mouse.click(pos.x, pos.y);
  const after = await G(page, () => window.__game.game.s.coins);
  assert.ok(after > before, '點擊金幣後金幣應增加');
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
  await G(page, () => { const { game } = window.__game; game.s.coins = 9999; game.setSpeed && 0; game.speed = 3; game.crew[0].rec.energy = 5; });
  await page.click('.bottom-bar [data-act=open-staff]');
  let fed = 0;
  for (let i = 0; i < 6; i++) {
    await G(page, () => { window.__game.game.crew[0].rec.energy = 5; });
    await page.waitForTimeout(120 + i * 70); // 讓面板定時更新在不同時間點發生
    const c0 = await G(page, () => window.__game.game.s.coins);
    await page.click('[data-act=feed]');
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

await browser.close();
server.close();
console.log(failed ? `\n${failed} 個情境失敗` : '\n全部端對端情境通過');
process.exit(failed ? 1 : 0);
