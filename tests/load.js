// 在 Node 中依序載入邏輯層（與 index.html 的載入順序一致）
'use strict';
const path = require('path');
for (const f of ['util', 'data', 'world', 'state', 'sim']) require(path.join(__dirname, '..', 'js', f + '.js'));
module.exports = globalThis.RC;
