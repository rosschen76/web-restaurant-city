/* 存檔編碼：輕量混淆 + 校驗碼。
 * 目的只是讓玩家不能隨手改存檔文字（例如把金幣改成 999999），不是真正的加密：
 * 遊戲完全在玩家的瀏覽器裡跑，金鑰必然在前端程式碼中，會讀原始碼的人還是能解開。
 * 格式：'PRC1:' + base64( 2 byte 隨機鹽 + XOR( 4 byte 校驗碼 + UTF-8 資料 ) )
 * 同一份存檔每次編碼結果都不同；任何一個字被改動，校驗碼就會對不起來。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});

  const PREFIX = 'PRC1:';
  const SECRET = 'pixel-restaurant-city::guard-v1';
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8', { fatal: true });

  /** FNV-1a 32 位元雜湊 */
  function fnv(bytes, seed) {
    let h = (seed ^ 0x811c9dc5) >>> 0;
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  const secretHash = fnv(enc.encode(SECRET), 0x9e3779b9);

  /** 以（金鑰 + 鹽）為種子的 xorshift32 位元組流 */
  function keystream(s0, s1) {
    let x = (secretHash ^ (s0 << 8) ^ s1 ^ 0xa5a5a5a5) >>> 0 || 1;
    return () => {
      x ^= x << 13;
      x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5;
      x >>>= 0;
      return (x >>> 8) & 255;
    };
  }

  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromBase64(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  /** 文字 → 存檔字串。rnd 可注入亂數函式（測試用）。 */
  function encode(text, rnd) {
    rnd = rnd || Math.random;
    const data = enc.encode(text);
    const ck = fnv(data, secretHash);
    const payload = new Uint8Array(4 + data.length);
    payload[0] = ck >>> 24;
    payload[1] = (ck >>> 16) & 255;
    payload[2] = (ck >>> 8) & 255;
    payload[3] = ck & 255;
    payload.set(data, 4);
    const s0 = Math.floor(rnd() * 256);
    const s1 = Math.floor(rnd() * 256);
    const next = keystream(s0, s1);
    const out = new Uint8Array(2 + payload.length);
    out[0] = s0;
    out[1] = s1;
    for (let i = 0; i < payload.length; i++) out[2 + i] = payload[i] ^ next();
    return PREFIX + toBase64(out);
  }

  /** 存檔字串 → 文字；格式不對、被改過或損毀時回傳 null。 */
  function decode(str) {
    try {
      if (typeof str !== 'string') return null;
      str = str.replace(/\s+/g, '');
      if (!str.startsWith(PREFIX)) return null;
      const bytes = fromBase64(str.slice(PREFIX.length));
      if (bytes.length < 6) return null; // 2 鹽 + 4 校驗碼
      const next = keystream(bytes[0], bytes[1]);
      const payload = new Uint8Array(bytes.length - 2);
      for (let i = 0; i < payload.length; i++) payload[i] = bytes[2 + i] ^ next();
      const ck = ((payload[0] << 24) | (payload[1] << 16) | (payload[2] << 8) | payload[3]) >>> 0;
      const data = payload.subarray(4);
      if (fnv(data, secretHash) !== ck) return null;
      return dec.decode(data);
    } catch (e) {
      return null;
    }
  }

  RC.codec = { PREFIX, encode, decode };
})(typeof globalThis !== 'undefined' ? globalThis : window);
