'use strict';
// 天數 / 營業時間 / 排班（每班 8 小時）/ 休息恢復 / 洗碗 / 值班店長 / 風評與遊戲終止
const test = require('node:test');
const assert = require('node:assert/strict');
const RC = require('./load.js');
const D = RC.data;

const mk = (seed = 1, mut) => {
  const s = RC.state.newGame(RC.util.makeRng(seed));
  if (mut) mut(s);
  return new RC.Game(s, { seed }); // dayMode 預設開啟
};
const run = (g, sec, dt = 0.1) => {
  for (let t = 0; t < sec; t += dt) g.update(dt);
};
/** 跑到遊戲內經過 hours 小時為止 */
function runHours(g, hours, onStep) {
  const target = g.absMin() + hours * 60;
  let guard = 0;
  while (g.absMin() < target && guard++ < 2e6) {
    g.update(0.1);
    if (onStep) onStep();
  }
  assert.ok(guard < 2e6, '時鐘沒有前進');
}
const hire = (g, n = 1) => {
  g.s.coins = 1e6;
  g.s.level = Math.max(g.s.level, 12);
  for (let i = 0; i < n; i++) assert.equal(g.hire(0).ok, true);
};

test('新遊戲：第 1 天 09:00、預設營業 09:00~17:00、掌櫃 9 點上班', () => {
  const g = mk();
  assert.equal(g.s.day, 1);
  assert.equal(g.hour, 9);
  assert.deepEqual(g.s.schedule, { open: 9, close: 17, auto: true });
  assert.equal(g.isOpen(), true);
  const boss = g.crew[0];
  assert.equal(boss.onDuty, true);
  assert.equal(g.s.staff[0].shift, 9);
});

test('時鐘：營業中 1 遊戲小時 = 25 真實秒；打烊且店裡沒人時快轉', () => {
  const g = mk();
  const t0 = g.s.clock;
  run(g, D.DAY.hourReal);
  assert.ok(Math.abs(g.s.clock - t0 - 60) < 1, '25 秒前進約 60 分鐘，實際 ' + (g.s.clock - t0));
  // 跑到打烊並讓客人都走光、事情做完
  runHours(g, 9);
  assert.equal(g.isOpen(), false);
  // 等客人走光（掌櫃 17 點下班後沒人收桌子，髒碗要等隔天，不必等它）
  for (let i = 0; i < 3000 && (g.customers.length || g.queue.length); i++) g.update(0.1);
  assert.equal(g.customers.length, 0);
  assert.equal(g.isOpen(), false);
  const c0 = g.s.clock;
  run(g, 10);
  const dm = g.s.clock - c0;
  assert.ok(dm > 10 * (60 / D.DAY.hourReal) * D.DAY.nightFast * 0.9, '夜間快轉約 ×6，10 秒前進 ' + dm.toFixed(0) + ' 分鐘');
});

test('營業時間：打烊後不再有新客人，門外候位的客人離開，已入座的繼續吃完', () => {
  const g = mk(3);
  let spawnedAfterClose = 0;
  let lastId = 0;
  runHours(g, 7.9);
  lastId = g.nextCid;
  runHours(g, 0.2);
  assert.equal(g.isOpen(), false);
  const idAtClose = g.nextCid;
  runHours(g, 5);
  spawnedAfterClose = g.nextCid - idAtClose;
  assert.equal(spawnedAfterClose, 0, '打烊後不該有新客人');
  assert.equal(g.queue.length, 0);
  assert.ok(lastId > 1);
});

test('跨過午夜：天數 +1，並發出當日結算事件', () => {
  const g = mk(4);
  const days = [];
  g.on('newday', (e) => days.push(e));
  runHours(g, 16);
  assert.equal(g.s.day, 2);
  assert.equal(days.length, 1);
  assert.equal(days[0].day, 2);
  assert.ok(days[0].served >= 0 && Number.isFinite(days[0].earned));
});

test('自訂營業時間：驗證範圍、打烊要晚於開店、自動排班跟著更新', () => {
  const g = mk();
  assert.equal(g.setBusinessHours(10, 10).ok, false);
  assert.equal(g.setBusinessHours(12, 9).ok, false);
  assert.equal(g.setBusinessHours(-1, 9).ok, false);
  assert.equal(g.setBusinessHours(5, 25).ok, false);
  assert.equal(g.setBusinessHours(10, 22).ok, true);
  assert.deepEqual([g.s.schedule.open, g.s.schedule.close], [10, 22]);
  assert.equal(g.s.staff[0].shift, 10, '自動排班：掌櫃排開店班');
  g.setBusinessHours(0, 24);
  assert.equal(g.isOpen(), true);
});

test('每位員工每天最多上班 8 小時：連續多天量測在班時間（含掌櫃）', () => {
  const g = mk(5);
  hire(g, 2);
  g.setBusinessHours(8, 22); // 14 小時：需要錯開的班
  const minutes = new Map();
  const dayOf = () => g.s.day;
  let lastAbs = g.absMin();
  runHours(g, 24 * 4, () => {
    const now = g.absMin();
    const dm = now - lastAbs;
    lastAbs = now;
    for (const m of g.crew) {
      if (!m.onDuty) continue;
      const k = m.id + ':' + dayOf();
      minutes.set(k, (minutes.get(k) || 0) + dm);
    }
  });
  let worst = 0;
  for (const v of minutes.values()) worst = Math.max(worst, v);
  // 班是 8 小時；打烊後客人與餐具沒收完時留下收店，最多再加班 2 小時（見下方收店測試）
  assert.ok(worst <= 8 * 60 + D.DAY.closeOvertimeMin + 1, '最長單日在班 ' + (worst / 60).toFixed(2) + ' 小時');
  assert.ok(worst >= 7 * 60, '員工確實有上班');
});

test('下班的人走出店門，上班時從門口進來', () => {
  const g = mk(6);
  const boss = g.crew[0];
  const events = [];
  g.on('clockout', (e) => events.push('out'));
  g.on('clockin', (e) => events.push('in'));
  runHours(g, 8); // 17:00 打烊
  let guard = 0;
  while (boss.onDuty && guard++ < 3000) g.update(0.1); // 客人用完餐、餐具洗完（最多加班 2 小時）才下班
  assert.equal(boss.onDuty, false, '收完店掌櫃下班');
  runHours(g, 0.1);
  runHours(g, 15.5);
  assert.equal(boss.onDuty, true, '隔天 9 點又上班');
  assert.deepEqual(events.slice(0, 2), ['out', 'in']);
});

test('沒有任何人值班的時段，客人不會上門', () => {
  const g = mk(7, (s) => (s.staff[0].shift = 20)); // 掌櫃 20:00~04:00 上班，營業時間內沒人
  g.s.schedule.auto = false;
  runHours(g, 7);
  assert.equal(g.anyOnDuty(), false);
  assert.equal(g.nextCid, 1, '營業中但沒人值班：沒有客人進門');
  assert.equal(g.customers.length, 0);
});

test('新雇的員工當下立刻上班；自動排班在隔天重新規劃', () => {
  const g = mk(8);
  runHours(g, 3); // 12:00
  hire(g, 1);
  const rec = g.s.staff[1];
  assert.equal(rec.shift, 12);
  assert.equal(g.crew[1].onDuty, true);
  runHours(g, 13); // 過了午夜
  assert.equal(g.s.day, 2);
  assert.equal(g.s.staff[0].shift, g.s.schedule.open, '自動排班把掌櫃排回開店班');
});

test('離崗休息：體力逐漸恢復，休息滿 2 小時直接補滿', () => {
  const g = mk(9);
  hire(g, 1);
  const m = g.crew[1];
  g.s.schedule.auto = false;
  m.rec.shift = 21; // 這段時間不在班，才不會馬上又被叫回來
  m.rec.energy = 5;
  g.clockOut(m, g.absMin());
  assert.equal(m.onDuty, false);
  runHours(g, 0.5);
  assert.ok(m.rec.energy > 5 && m.rec.energy < 100, '休息半小時只恢復一部分：' + m.rec.energy.toFixed(0));
  assert.ok(m.rec.energy < 100);
  runHours(g, 1.6); // 累計 2.1 小時
  assert.equal(m.rec.energy, 100);
});

test('自動排班：把 8 小時的班錯開蓋滿營業時間；掌櫃開店、值班店長收店', () => {
  const g = mk(10);
  hire(g, 2);
  g.setBusinessHours(9, 21); // 12 小時 → 2 個班：9 點、13 點
  const [boss, a, b] = g.s.staff;
  assert.equal(boss.shift, 9);
  const cov = g.coverage();
  for (let h = 9; h < 21; h++) assert.ok(cov.staff[h] >= 1, h + ':00 要有人');
  // 任命店長 → 店長排收店班
  a.level = 10;
  assert.equal(g.assignManager(a.id).ok, true);
  assert.equal(boss.shift, 9);
  assert.equal(a.shift, 13, '值班店長排最後一班');
  const cov2 = g.coverage();
  for (let h = 9; h < 21; h++) assert.ok(cov2.payers[h] >= 1, h + ':00 要有人能結帳');
  g.setBusinessHours(0, 24); // 24 小時營業：3 個班
  assert.deepEqual([...new Set(g.s.staff.map((m) => m.shift))].sort((x, y) => x - y).length >= 2, true);
});

test('手動排班會關閉自動排班；再打開自動排班會重新規劃', () => {
  const g = mk(11);
  hire(g, 1);
  assert.equal(g.setShift(g.s.staff[1].id, 14).ok, true);
  assert.equal(g.s.staff[1].shift, 14);
  assert.equal(g.s.schedule.auto, false);
  assert.equal(g.setShift(999, 3).ok, false);
  assert.equal(g.setShift(g.s.staff[1].id, 24).ok, false);
  g.setBusinessHours(9, 17); // 手動模式不會被覆蓋
  assert.equal(g.s.staff[1].shift, 14);
  g.setAutoSchedule(true);
  assert.equal(g.s.staff[1].shift, 9);
});

test('值班店長：Lv.10 才能任命、只能一位、不能是掌櫃；可以兼任結帳', () => {
  const g = mk(12);
  hire(g, 2);
  const [boss, a, b] = g.s.staff;
  assert.equal(g.assignManager(boss.id).ok, false, '掌櫃不用任命');
  assert.equal(g.assignManager(a.id).ok, false, '等級不夠');
  assert.equal(g.clearManager().ok, false);
  a.level = 10;
  b.level = 10;
  assert.equal(g.assignManager(a.id).ok, true);
  assert.equal(a.manager, true);
  assert.equal(g.assignManager(b.id).ok, true, '可以再任命第二位');
  assert.equal(a.manager && b.manager, true, '每間店最多兩位值班店長');
  assert.equal(g.assignManager(a.id).ok, false, '已經是店長了');
  assert.equal(g.clearManager(a.id).ok, true, '可以指定解除哪一位');
  assert.equal(a.manager, false);
  assert.equal(b.manager, true);
  assert.equal(g.clearManager().ok, true);
  assert.equal(b.manager, false);
});

test('值班店長最多 2 位：第三位要先解除一位', () => {
  const g = mk(14);
  hire(g, 3);
  const [, x, y, z] = g.s.staff;
  [x, y, z].forEach((m) => (m.level = 10));
  assert.equal(g.assignManager(x.id).ok, true);
  assert.equal(g.assignManager(y.id).ok, true);
  const r = g.assignManager(z.id);
  assert.equal(r.ok, false);
  assert.ok(r.msg.includes('最多'), r.msg);
  g.clearManager(x.id);
  assert.equal(g.assignManager(z.id).ok, true);
});

test('掌櫃下班後，值班店長接手結帳；兩人都不在就很快自助結帳', () => {
  const g = mk(13);
  hire(g, 1);
  g.s.staff[1].level = 10;
  g.s.schedule.auto = false;
  g.s.staff[0].shift = 20; // 掌櫃營業時段不上班
  g.s.staff[1].shift = 9;
  g.assignManager(g.s.staff[1].id);
  g.s.staff[1].shift = 9;
  g.s.schedule.auto = false;
  g.updateDuty();
  const mgr = g.crew[1];
  assert.equal(g.payerOn, true, '店長在班可以收款');
  let paidByManager = 0;
  for (let t = 0; t < 300; t += 0.1) {
    g.update(0.1);
    if (mgr.state === 'paying') paidByManager++;
    assert.ok(!(g.crew[0].onDuty && g.crew[0].pay), '掌櫃下班了不收款');
  }
  assert.ok(paidByManager > 0, '店長有親自收款');
  // 店長也下班：沒有人能收款
  g.s.staff[1].shift = 20;
  g.updateDuty();
  runHours(g, 0.2);
  assert.equal(g.payerOn, false);
});

test('沒有人能收款時，客人 12 秒後自助結帳（沒有小費）', () => {
  const g = mk(14, (s) => {
    s.staff[0].shift = 9;
  });
  hire(g, 1); // 一般員工負責煮菜上菜
  g.s.schedule.auto = false;
  g.s.staff[0].shift = 22; // 掌櫃營業時間不在
  g.updateDuty();
  assert.equal(g.payerOn, false);
  let selfPaid = 0;
  for (let t = 0; t < 400; t += 0.1) {
    g.update(0.1);
    for (const c of g.customers) if (c.state === 'wait_pay') assert.ok(c.payWait <= 12.5, '最多等 12 秒：' + c.payWait.toFixed(1));
  }
  assert.ok(g.s.stats.served > 0 && g.s.stats.collects > 0, '仍然有收入');
  selfPaid = g.s.stats.tips;
  assert.equal(selfPaid, 0, '自助結帳沒有小費');
});

test('員工等級上限 15；升到 10 級時提示可任命值班店長；每級技術 +0.03、速度 +0.02', () => {
  const g = mk(15);
  hire(g, 1);
  const rec = g.s.staff[1];
  assert.equal(D.STAFF_XP_STEPS.length, 15);
  for (let i = 2; i < D.STAFF_XP_STEPS.length; i++) assert.ok(D.STAFF_XP_STEPS[i] > D.STAFF_XP_STEPS[i - 1]);
  rec.level = 9;
  rec.xp = D.STAFF_XP_STEPS[9] - 1;
  const toasts = [];
  g.on('toast', (e) => toasts.push(e.msg));
  const sp = rec.speed;
  const sk = rec.skill;
  g.gainStaffXp(rec);
  assert.equal(rec.level, 10);
  assert.ok(toasts.some((t) => t.includes('值班店長')));
  assert.ok(Math.abs(rec.speed - sp - 0.02) < 1e-9 && Math.abs(rec.skill - sk - 0.03) < 1e-9);
  rec.xp = 99999;
  for (let i = 0; i < 10; i++) g.gainStaffXp(rec);
  assert.equal(rec.level, 15, '最高 15 級');
  g.gainStaffXp(rec);
  assert.equal(rec.level, 15, '不會超過 15 級');
});

/* ───────── 打烊收店：客人服務完、餐具洗完，員工才下班 ───────── */

/** 跑到 17:00 打烊（客人已經入座、桌上有餐點）；回傳遊戲 */
function untilClose(seed, mut) {
  const g = mk(seed, mut);
  hire(g, 1);
  g.setBusinessHours(9, 17);
  g.setAutoSchedule(false);
  g.s.staff.forEach((m) => (m.shift = 9)); // 全部 9:00~17:00
  runHours(g, 8); // 9:00 → 17:00
  return g;
}

test('打烊時店裡還有客人：在班的員工留下來，客人吃完、結帳、桌子與餐具都收洗完才下班', () => {
  let g, seenBusy = false;
  for (const seed of [21, 22, 23, 24, 25]) {
    g = untilClose(seed);
    if (g.closingWork()) {
      seenBusy = true;
      break;
    }
  }
  assert.ok(seenBusy, '打烊時應該還有客人或餐具（這組種子才能測到收店）');
  assert.equal(g.isOpen(), false);
  assert.ok(g.crew.every((m) => m.onDuty), '班表已經到點，但店裡還有事，大家都還在');
  assert.ok(g.crew.every((m) => !m.ending), '收店的員工仍然接手新的工作（收桌子、洗碗、結帳），不是準備下班');
  let guard = 0;
  while (g.crew.some((m) => m.onDuty) && guard++ < 36000) {
    // 還有客人時，沒有人可以先走
    if (g.customers.length > 0) assert.ok(g.crew.some((m) => m.onDuty && (m.boss || m.rec.manager)), '客人還沒結完帳，掌櫃還在');
    g.update(0.1);
  }
  assert.ok(guard < 36000, '最後所有人都下班了');
  assert.equal(g.customers.length, 0, '客人全部服務完才下班');
  assert.equal(g.dirty.size, 0, '桌上沒有留下餐具');
  assert.equal(g.s.sinkDirty, 0, '洗碗槽裡的髒盤子洗完了');
  assert.equal(g.crew.reduce((n, m) => n + (m.carryPlates || 0), 0), 0);
  assert.equal(g.cleanPlates(), g.plateTotal(), '盤子全部是乾淨的');
});

test('收店加班有上限：最多 2 小時，之後一定下班（不會被卡住）', () => {
  const g = untilClose(26);
  // 製造一個永遠做不完的狀況：洗碗槽被移走，髒盤子洗不掉
  for (const it of [...g.s.items]) if (it.id === 'sink') g.storeItem(it.uid);
  g.s.sinkDirty = 5;
  const t0 = g.absMin();
  let guard = 0;
  while (g.crew.some((m) => m.onDuty) && guard++ < 100000) g.update(0.1);
  const used = g.absMin() - t0;
  assert.ok(g.crew.every((m) => !m.onDuty), '加班到上限就下班');
  assert.ok(used <= D.DAY.closeOvertimeMin + 5, `加班 ${used.toFixed(0)} 分鐘`);
});

test('收店只在已經打烊後才生效：營業中班表結束照樣下班（每班 8 小時）', () => {
  const g = mk(28);
  hire(g, 1);
  g.setBusinessHours(8, 22);
  g.setAutoSchedule(false);
  g.s.staff.forEach((m) => (m.shift = 8)); // 8:00~16:00，營業到 22:00
  runHours(g, 0.1);
  g.crew.forEach((m) => assert.equal(m.onDuty, true));
  runHours(g, 8.8); // 約 16:50
  assert.equal(g.isOpen(), true);
  assert.equal(g.closingWork(), false, '營業中不算收店');
  assert.ok(g.crew.every((m) => !m.onDuty), '還在營業時間，班表到了照樣下班');
});

test('打烊後新客人不會再進門，候位的客人也離開；店裡的客人照常服務完', () => {
  const g = untilClose(29);
  const nBefore = g.nextCid;
  run(g, 60);
  assert.equal(g.nextCid, nBefore, '打烊後沒有新客人');
  assert.equal(g.queue.length, 0);
});
