// 在 Node 中依序載入邏輯層（與 index.html 的載入順序一致）
'use strict';
const path = require('path');
for (const f of ['util', 'dishes', 'data', 'world', 'codec', 'state', 'sim', 'company']) require(path.join(__dirname, '..', 'js', f + '.js'));
// 測試預設不限量供應食材（長時間模擬不會因為賣完而停擺）；要測進貨與庫存就明確傳 { stock: true }
const Real = globalThis.RC.Game;
globalThis.RC.Game = class extends Real {
  constructor(state, opts) {
    super(state, { stock: false, ...opts });
  }
};
module.exports = globalThis.RC;
