/* 入口：載入存檔、建立遊戲/繪圖/介面，啟動主迴圈與自動存檔。 */
(function () {
  'use strict';
  const RC = window.RC;

  const saved = RC.state.load();
  const state = saved || RC.state.newGame();
  const game = new RC.Game(state);
  const canvas = document.getElementById('game');
  const view = new RC.Renderer(canvas, game);
  const ui = new RC.UI(game, view);

  // 套用存檔裡的音訊偏好（實際出聲要等第一次使用者操作）
  RC.audio.sfxOn = state.settings.sound;
  RC.audio.musicOn = state.settings.music;
  ui.refreshHud();

  // 以菜色圖示當 favicon
  try {
    document.getElementById('favicon').href = RC.artPeople.iconURL('luroufan', 4, 'dish');
  } catch (e) {
    /* 非必要 */
  }

  const save = () => {
    if (!ui._skipSave) RC.state.save(game.s);
  };
  setInterval(save, 10000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
  });
  window.addEventListener('pagehide', save);

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
