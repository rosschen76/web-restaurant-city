/* 入口：載入存檔、建立遊戲/繪圖/介面，啟動主迴圈與自動存檔。 */
(function () {
  'use strict';
  const RC = window.RC;

  const saved = RC.state.load();
  const state = saved || RC.state.newGame();
  const game = new RC.Game(state);
  // 上次存檔到現在的這段時間：離線期間餐廳照常營業（savedAt 為 0 代表全新遊戲）
  const awayOnLoad = state.savedAt > 0 ? (Date.now() - state.savedAt) / 1000 : 0;
  const offlineReport = game.catchUp(awayOnLoad);
  const canvas = document.getElementById('game');
  const view = new RC.Renderer(canvas, game);
  const ui = new RC.UI(game, view);

  // 套用存檔裡的音訊偏好（實際出聲要等第一次使用者操作）
  RC.audio.sfxOn = state.settings.sound;
  RC.audio.musicOn = state.settings.music;
  RC.audio.sfxVol = state.settings.sfxVol;
  RC.audio.musicVol = state.settings.musicVol;
  ui.refreshHud();
  ui.showOffline(offlineReport);
  // 存檔版次差太多：不讀取，也先不要自動存檔（避免蓋掉舊存檔），等玩家按下「開始新遊戲」
  if (RC.state.loadStatus === 'incompatible') ui.showVersionBlocked(RC.state.loadInfo);
  if (RC.state.loadStatus === 'corrupt') ui.toast('存檔讀取失敗（可能損毀或被修改過），已重新開始。舊存檔有備份。', 'bad');

  // 以菜色圖示當 favicon
  try {
    document.getElementById('favicon').href = RC.artPeople.iconURL('luroufan', 4, 'dish');
  } catch (e) {
    /* 非必要 */
  }

  // 背景分頁不會跑遊戲，所以背景時不要定時存檔：否則存檔時間會被一直更新，
  // 之後關閉再開啟時就算不出「離開了多久」。離開那一刻的存檔由 visibilitychange 負責。
  const save = (force) => {
    if (ui._skipSave) return;
    if (document.hidden && !force) return;
    RC.state.save(game.s);
  };
  setInterval(save, 10000);

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      save(true);
    } else if (hiddenAt) {
      // 分頁回到前景：背景時 requestAnimationFrame 停了，把這段時間補算進去
      const away = (Date.now() - hiddenAt) / 1000;
      hiddenAt = 0;
      last = performance.now();
      ui.showOffline(game.catchUp(away));
    }
  });
  window.addEventListener('pagehide', () => save(false));

  let last = performance.now();
  let reported = false;
  function frame(now) {
    // 先排下一幀：就算這一幀出錯，遊戲也不會整個停擺
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      game.update(dt);
      view.render(dt);
      ui.update(dt);
    } catch (e) {
      console.error(e);
      if (!reported) {
        reported = true;
        ui.toast('發生未預期的錯誤。進度已自動保存，必要時請重新整理頁面。', 'bad');
      }
    }
  }
  requestAnimationFrame(frame);

  // 方便除錯與自動化測試
  window.__game = { game, view, ui };
})();
