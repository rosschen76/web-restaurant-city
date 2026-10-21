'use strict';
// 遊戲版次：存檔記錄版次；讀檔與匯入時檢查，差太多就拒絕（只能重新開局）
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;
const S = RC.state;

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), m };
};
/** 暫時把「目前版次」改成較大的數字，測試「差太多」的情況（目前只有兩版，還不會真的發生） */
const asVersion = (cur, fn) => {
  const keep = D.GAME_VERSION.current;
  D.GAME_VERSION.current = cur;
  try {
    return fn();
  } finally {
    D.GAME_VERSION.current = keep;
  }
};
const withVersion = (v) => {
  const raw = JSON.parse(RC.codec.decode(S.serialize(S.newGame(RC.util.makeRng(1)))));
  if (v === undefined) delete raw.v;
  else raw.v = v;
  return RC.codec.encode(JSON.stringify(raw));
};

test('存檔帶有目前的遊戲版次', () => {
  const raw = JSON.parse(RC.codec.decode(S.serialize(S.newGame(RC.util.makeRng(1)))));
  assert.equal(raw.v, D.GAME_VERSION.current);
});

test('checkVersion：目前版次、舊一版可讀；沒有版次欄位視為版次 1', () => {
  const cur = D.GAME_VERSION.current;
  assert.equal(S.checkVersion(cur).ok, true);
  assert.equal(S.checkVersion(undefined).ok, cur - 1 <= D.GAME_VERSION.maxGap);
  assert.equal(S.checkVersion(undefined).version, 1);
});

test('checkVersion：差太多、比目前新、亂填的版次都不可讀', () => {
  const { current, maxGap } = D.GAME_VERSION;
  assert.deepEqual(S.checkVersion(current + 1), { ok: false, version: current + 1, reason: 'new' });
  asVersion(10, () => {
    assert.equal(S.checkVersion(10 - maxGap).ok, true);
    assert.deepEqual(S.checkVersion(10 - maxGap - 1), { ok: false, version: 10 - maxGap - 1, reason: 'old' });
    assert.equal(S.checkVersion(1).reason, 'old');
  });
  for (const bad of ['2', NaN, -1, 0, 1.5, {}]) assert.equal(S.checkVersion(bad).ok, false, String(bad));
});

test('parse：版次不合丟出 code=version 的錯誤；舊版次存檔可以轉換讀取', () => {
  assert.throws(() => S.parse(withVersion(D.GAME_VERSION.current + 1)), (e) => e.code === 'version' && e.check.reason === 'new');
  const tooOld = withVersion(1);
  asVersion(10, () => assert.throws(() => S.parse(tooOld), (e) => e.code === 'version' && e.check.reason === 'old'));
  const st = S.parse(withVersion(1));
  assert.equal(st.staff.length >= 1, true);
});

test('load：版次不相容 → 回傳 null、loadStatus=incompatible、舊存檔另外備份且原存檔保留', () => {
  const store = memStorage();
  const text = withVersion(D.GAME_VERSION.current + 5);
  store.setItem(S.SAVE_KEY, text);
  assert.equal(S.load(store), null);
  assert.equal(S.loadStatus, 'incompatible');
  assert.equal(S.loadInfo.reason, 'new');
  assert.equal(store.getItem(S.SAVE_KEY + '/incompatible-backup'), text);
  assert.equal(store.getItem(S.SAVE_KEY + '/corrupt-backup'), null);
});

test('load：版次差太多（舊）同樣被拒絕並備份', () => {
  const store = memStorage();
  const text = withVersion(1);
  store.setItem(S.SAVE_KEY, text);
  asVersion(10, () => assert.equal(S.load(store), null));
  assert.equal(S.loadStatus, 'incompatible');
  assert.equal(S.loadInfo.reason, 'old');
  assert.equal(store.getItem(S.SAVE_KEY + '/incompatible-backup'), text);
});

test('load：一般存檔 ok；損毀存檔仍是 corrupt（與版次問題分開）', () => {
  const store = memStorage();
  assert.equal(S.load(store), null);
  assert.equal(S.loadStatus, 'none');
  store.setItem(S.SAVE_KEY, S.serialize(S.newGame(RC.util.makeRng(2))));
  assert.ok(S.load(store));
  assert.equal(S.loadStatus, 'ok');
  store.setItem(S.SAVE_KEY, 'PRC1:garbage');
  assert.equal(S.load(store), null);
  assert.equal(S.loadStatus, 'corrupt');
  assert.equal(S.loadInfo, null);
});

test('load：舊的明文 JSON 存檔（無版次）也走版次檢查', () => {
  const store = memStorage();
  const raw = JSON.parse(RC.codec.decode(S.serialize(S.newGame(RC.util.makeRng(3)))));
  raw.v = D.GAME_VERSION.current + 1;
  store.setItem(S.SAVE_KEY, JSON.stringify(raw));
  assert.equal(S.load(store), null);
  assert.equal(S.loadStatus, 'incompatible');
});
