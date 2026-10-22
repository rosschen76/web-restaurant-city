/* 介面層：HUD、各面板、編輯模式（擺放/移動家具）、輸入處理。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});
  const D = RC.data;
  const AP = RC.artPeople;
  const AW = RC.artWorld;
  const gfx = RC.gfx;
  const fmt = RC.util.fmt;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ic = (name, scale) => `<img class="px" src="${AP.iconURL(name, scale || 2)}" width="${12 * (scale || 2)}" height="${12 * (scale || 2)}" alt="">`;

  const hhmm = (h) => String(((h % 24) + 24) % 24).padStart(2, '0') + ':00';
  const shiftText = (start) => `${hhmm(start)} – ${hhmm(start + D.DAY.shiftHours)}`;

  const avatarCache = new Map();
  function avatar(look, staff, boss) {
    const key = JSON.stringify(look) + staff + (boss ? 'B' : '');
    let u = avatarCache.get(key);
    if (!u) {
      const c = gfx.canvas(20, 36);
      AP.drawPerson(gfx.ctx(c), 10, 34, look, { dir: 1, staff: !!staff, boss: !!boss });
      const big = gfx.canvas(40, 72);
      gfx.ctx(big).drawImage(c, 0, 0, 40, 72);
      u = big.toDataURL();
      avatarCache.set(key, u);
    }
    return u;
  }

  const STATE_SHORT = { idle: '待命', rest: '休息中', to_customer: '去點餐', taking: '點餐中', wait_stove: '等爐灶', to_stove: '去煮菜', cooking: '烹飪中', to_serve: '送餐中', serving: '上菜中', to_clean: '去收桌子', cleaning: '收拾中', to_pay: '去結帳', paying: '收款中', wait_plate: '等乾淨盤子', to_sink: '送餐具去洗碗槽', dropping: '放下餐具', to_wash: '去洗碗', washing: '洗碗中' };
  const PANELS = {
    shop: { title: '商店', icon: 'shop' },
    inv: { title: '倉庫', icon: 'box' },
    menu: { title: '菜單', icon: 'book' },
    staff: { title: '員工', icon: 'person' },
    quest: { title: '任務', icon: 'scroll' },
    settings: { title: '設定', icon: 'gear' },
  };
  const SHOP_TABS = [
    ...D.FURNITURE_CATS.map((c) => ({ id: c.id, name: c.name })),
    { id: 'floor', name: '地板' },
    { id: 'wall', name: '牆壁' },
    { id: 'expand', name: '擴建' },
  ];

  class UI {
    constructor(game, view) {
      this.game = game;
      this.view = view;
      this.hud = document.getElementById('hud');
      this.modalRoot = document.getElementById('modal-root');
      this.toasts = document.getElementById('toasts');
      this.panel = null; // {name, tab}
      this.placing = null; // {id, rot, fromUid, drag}
      this.edit = false;
      this.actor = null;
      this.dirty = true;
      this.panelTimer = 0;
      this.actorTimer = 0;
      this.warnTimer = 0;
      this.coinShown = game.s.coins;
      this.lvQueue = [];
      this.hover = { x: -1, y: -1 };
      this.pointer = null;
      this.lastAngry = 0;
      this.buildHud();
      this.bindGame();
      this.bindInput();
      this.refreshHud();
      if (game.s.over) this.showGameOver();
      else if (!game.s.flags.welcomed) this.showWelcome();
      else if (game.s.flags.addedSink && !game.s.flags.sinkToldAt) {
        game.s.flags.sinkToldAt = 1;
        this.toast('新增了洗碗槽：髒餐具要先送去洗，沒有乾淨盤子就不能出菜。', 'good');
      }
    }

    /* ───────── HUD ───────── */

    buildHud() {
      this.hud.innerHTML = `
        <div class="hud-left"><div class="hud-tl pbox" id="hud-tl">
          <div class="lv-badge">Lv<b id="lv">1</b></div>
          <div class="hud-info">
            <div class="rname"><span id="rname"></span></div>
            <div class="stars" id="stars"></div>
            <div class="clockline" id="clock"></div>
            <div class="bar xp"><i id="xpbar"></i></div>
            <div class="bar-label" id="xplabel"></div>
          </div>
        </div>
        <div class="quest-card pbox" id="quest" data-act="open-quest" hidden></div></div>
        <div class="hud-tr">
          <div class="coin-pill pbox" id="coinpill">${ic('coin', 2)}<span id="coins">0</span></div>
          <button class="btn icon-btn" id="btn-pause" title="暫停／繼續（空白鍵）" aria-label="暫停或繼續"></button>
          <button class="btn icon-btn" id="btn-speed" title="遊戲速度（1 / 2 / 3）">×1</button>
          <button class="btn icon-btn" id="btn-sfx" title="音效開關" aria-label="音效開關"></button>
          <button class="btn icon-btn" id="btn-music" title="音樂開關" aria-label="音樂開關"></button>
        </div>
        <div class="warn-banner pbox" id="warn" hidden></div>
        <div class="warn-banner pause-badge pbox" id="pause" hidden>⏸ 裝潢中：遊戲時間已暫停</div>
        <div class="bottom-bar pbox" id="bottom">
          <button class="btn nav-btn" data-act="open-shop">${ic('shop', 2)}商店</button>
          <button class="btn nav-btn" data-act="toggle-edit">${ic('hammer', 2)}裝潢</button>
          <button class="btn nav-btn" data-act="open-menu" id="nav-menu">${ic('book', 2)}菜單</button>
          <button class="btn nav-btn" data-act="open-staff" id="nav-staff">${ic('person', 2)}員工</button>
          <button class="btn nav-btn" data-act="open-quest" id="nav-quest">${ic('scroll', 2)}任務</button>
          <button class="btn nav-btn" data-act="open-settings">${ic('gear', 2)}設定</button>
        </div>
        <div class="edit-bar pbox" id="editbar" hidden>
          <span class="hint" id="edithint"></span>
          <button class="btn small" data-act="open-inv">${ic('box', 1)} 倉庫</button>
          <button class="btn small" data-act="open-shop">${ic('shop', 1)} 商店</button>
          <button class="btn small primary" data-act="toggle-edit">${ic('check', 1)} 完成</button>
        </div>
        <div class="item-toolbar pbox" id="itemtool" hidden></div>
        <div class="actor-card pbox" id="actor" hidden></div>`;
      this.el = {
        lv: this.hud.querySelector('#lv'),
        rname: this.hud.querySelector('#rname'),
        stars: this.hud.querySelector('#stars'),
        clock: this.hud.querySelector('#clock'),
        xpbar: this.hud.querySelector('#xpbar'),
        xplabel: this.hud.querySelector('#xplabel'),
        coins: this.hud.querySelector('#coins'),
        coinpill: this.hud.querySelector('#coinpill'),
        pause: this.hud.querySelector('#btn-pause'),
        speed: this.hud.querySelector('#btn-speed'),
        sfx: this.hud.querySelector('#btn-sfx'),
        music: this.hud.querySelector('#btn-music'),
        quest: this.hud.querySelector('#quest'),
        warn: this.hud.querySelector('#warn'),
        pauseBadge: this.hud.querySelector('#pause'),
        bottom: this.hud.querySelector('#bottom'),
        editbar: this.hud.querySelector('#editbar'),
        edithint: this.hud.querySelector('#edithint'),
        itemtool: this.hud.querySelector('#itemtool'),
        actor: this.hud.querySelector('#actor'),
        navMenu: this.hud.querySelector('#nav-menu'),
        navStaff: this.hud.querySelector('#nav-staff'),
        navQuest: this.hud.querySelector('#nav-quest'),
      };
    }

    setText(el, text) {
      if (el.textContent !== text) el.textContent = text;
    }

    refreshHud() {
      const s = this.game.s;
      const g_ = this.game;
      const need = D.xpForLevel(s.level);
      this.setText(this.el.lv, String(s.level));
      this.setText(this.el.rname, s.name);
      const stars = this.game.stars;
      const next = D.nextStarAppeal(stars);
      const glyphs = Array.from({ length: D.MAX_STARS }, (_, i) => (i < stars ? '★' : '<span class="off">★</span>')).join('');
      const html = `<span class="star-row" title="${D.STAR_TITLES[stars]}">${glyphs}</span> ${D.STAR_TITLES[stars].split('・')[0]}　魅力 ${Math.floor(this.game.appeal)}${next ? ` / ${next}` : ''}`;
      if (this.el.stars.innerHTML !== html) this.el.stars.innerHTML = html;
      this.updateClock();
      this.el.xpbar.style.width = (s.level >= D.MAX_LEVEL ? 100 : Math.min(100, (s.xp / need) * 100)) + '%';
      this.setText(this.el.xplabel, s.level >= D.MAX_LEVEL ? '已達最高等級' : `經驗 ${s.xp} / ${need}`);
      this.setText(this.el.speed, '×' + this.game.speed);
      // 暫停鈕：玩家手動暫停時顯示「繼續」圖示
      const pIcon = g_.isPausedBy('user') ? 'resume' : 'pause';
      if (this.el.pause.dataset.i !== pIcon) {
        this.el.pause.dataset.i = pIcon;
        this.el.pause.innerHTML = ic(pIcon, 2);
      }
      this.el.pause.classList.toggle('on', g_.isPausedBy('user'));
      this.updatePauseBadge();
      // 音效與音樂各自一顆按鈕：開著是亮的圖示，關掉是斜線
      const sfxIcon = RC.audio.sfxOn ? 'sound' : 'mute';
      if (this.el.sfx.dataset.i !== sfxIcon) {
        this.el.sfx.dataset.i = sfxIcon;
        this.el.sfx.innerHTML = ic(sfxIcon, 2);
      }
      const musicKey = RC.audio.musicOn ? 'on' : 'off';
      if (this.el.music.dataset.i !== musicKey) {
        this.el.music.dataset.i = musicKey;
        this.el.music.innerHTML = `<img class="px" src="${AP.iconURL('note', 2, RC.audio.musicOn ? undefined : 'off')}" width="24" height="24" alt="">`;
      }
      this.el.sfx.classList.toggle('muted', !RC.audio.sfxOn);
      this.el.music.classList.toggle('muted', !RC.audio.musicOn);
      this.refreshQuest();
      this.refreshBadges();
    }

    refreshQuest() {
      const cur = this.game.currentQuest();
      const el = this.el.quest;
      if (!cur) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.classList.toggle('done', cur.done);
      const pct = Math.round((cur.progress / cur.q.n) * 100);
      const html = `<div class="qt">任務 ${this.game.s.quest.i + 1}/${D.quests.length}</div><div class="qx">${esc(cur.q.text)}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="bar-label">${fmt(cur.progress)} / ${fmt(cur.q.n)}　獎勵 ${ic('coin', 1)}${fmt(cur.q.reward)}</div>
        ${cur.done ? '<button class="btn small primary" data-act="claim">領取獎勵</button>' : ''}`;
      if (el.innerHTML !== html) el.innerHTML = html;
    }

    refreshBadges() {
      const g = this.game;
      const s = g.s;
      const set = (el, show, text) => {
        let b = el.querySelector('.badge');
        if (show && !b) {
          b = document.createElement('span');
          b.className = 'badge';
          el.appendChild(b);
        }
        if (b) {
          if (!show) b.remove();
          else b.textContent = text;
        }
      };
      const q = g.currentQuest();
      set(this.el.navQuest, !!(q && q.done), '!');
      const learnable = D.dishList.filter((d) => !s.dishes[d.id] && s.level >= d.level && s.coins >= d.learn).length;
      set(this.el.navMenu, learnable > 0, String(learnable));
      const hireable = s.staff.filter((m) => !m.boss).length < D.maxStaffForLevel(s.level) && s.candidates.some((c) => s.coins >= RC.state.dailyWage(c, s.staff.length));
      set(this.el.navStaff, hireable, '+');
    }

    updateWarn() {
      const g = this.game;
      let msg = '';
      if (g.s.over) msg = '餐廳已經倒閉了。到「設定 → 存檔」重新開始。';
      else if (g.dayMode && g.isOpen() && !g.anyOnDuty()) msg = '營業時間裡沒有人在班！到「員工 → 排班」調整班表。';
      else if (!g.sinks.length) msg = '沒有洗碗槽！髒餐具沒地方洗，盤子用完就沒辦法出菜了。到「商店」買一個。';
      else if (g.cleanPlates() < 1 && g.dirty.size + g.s.sinkDirty > 0) msg = '乾淨的盤子用完了，等員工洗好碗才能繼續出菜（多買盤子或多請人洗碗）。';
      else if (!g.stoves.length) msg = '沒有可用的爐灶！到「商店」買一座，並放在有空位站人的地方。';
      else if (!g.seats.length) msg = '沒有座位！椅子必須緊鄰桌子，客人才會入座。';
      else if (g.crew.filter((m) => m.state === 'wait_stove').length >= 1 && g.stoves.length < g.crew.length) msg = '爐灶不夠，員工在排隊等爐灶，多買一座吧。';
      else if (g.queuePeople() >= 4) msg = `門外有 ${g.queuePeople()} 人在候位：增加桌椅（或更大的桌子）可以讓更多人入座。`;
      else if (g.s.lowDays >= 5) msg = `風評已連續 ${g.s.lowDays} 天跌到谷底，滿 ${D.REPUTATION.loseDays} 天餐廳就要倒閉了！`;
      else if (g.dirty.size >= 3) msg = '桌上的餐具堆積了，雇用更多員工幫忙收桌子吧。';
      else if (g.customers.filter((c) => c.state === 'wait_pay').length >= 3) msg = '好幾位客人等著結帳，掌櫃忙不過來：多雇員工分擔煮菜上菜，讓掌櫃專心收款（也可以買收銀機）。';
      const el = this.el.warn;
      if (this.game.paused) {
        el.hidden = true;
      } else if (msg) {
        this.setText(el, '⚠ ' + msg);
        el.hidden = false;
      } else el.hidden = true;
    }

    toast(msg, kind) {
      const t = document.createElement('div');
      t.className = 'toast ' + (kind || '');
      t.textContent = msg;
      this.toasts.appendChild(t);
      while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
      setTimeout(() => t.remove(), 2700);
    }

    /* ───────── 遊戲事件 ───────── */

    bindGame() {
      const g = this.game;
      const A = RC.audio;
      g.on('toast', (e) => this.toast(e.msg, e.kind));
      g.on('changed', () => (this.dirty = true));
      g.on('collect', () => A.sfx('coin'));
      g.on('coins', (e) => {
        if (e.n > 0 && !e.silent) {
          this.el.coinpill.classList.remove('bump');
          void this.el.coinpill.offsetWidth;
          this.el.coinpill.classList.add('bump');
        }
      });
      g.on('drop', () => A.sfx('ping'));
      g.on('served', (e) => e.vip && A.sfx('ding'));
      g.on('angry', () => {
        const now = performance.now();
        if (now - this.lastAngry > 1500) A.sfx('angry');
        this.lastAngry = now;
      });
      g.on('sfx', (n) => A.sfx(n));
      g.on('levelup', (e) => {
        A.sfx('levelup');
        this.lvQueue.push(e);
        if (!this.panel || this.panel.name !== 'levelup') this.showLevelUp();
      });
      g.on('gameover', () => {
        A.sfx('error');
        this.showGameOver();
      });
      g.on('questdone', (q) => {
        A.sfx('quest');
        this.toast(`任務完成！獲得 ${fmt(q.reward)} 金幣`, 'good');
      });
    }

    /* ───────── 面板 ───────── */

    openPanel(name, tab) {
      if (this.panel && this.panel.name === name && this.panel.overlay) return;
      this.closePanel(true);
      const def = PANELS[name];
      this.panel = { name, tab: tab || (name === 'shop' ? 'table' : name === 'settings' ? 'main' : name === 'staff' ? 'crew' : null) };
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.innerHTML = `<div class="win pbox"><div class="win-head"><div class="t">${ic(def.icon, 2)}<span>${def.title}</span></div><div class="x" data-act="close">✕</div></div><div class="tabs-slot"></div><div class="win-body"></div></div>`;
      overlay.addEventListener('pointerdown', (e) => {
        if (e.target === overlay) this.closePanel();
      });
      this.modalRoot.appendChild(overlay);
      this.panel.overlay = overlay;
      if (name === 'settings') this.game.setPause('settings', true); // 開著設定時遊戲暫停
      this.renderPanel();
    }

    /** 遊戲時鐘與風評 */
    updateClock() {
      const g = this.game;
      const s = g.s;
      const hh = String(Math.floor(s.clock / 60)).padStart(2, '0');
      const mm = String(Math.floor(s.clock % 60)).padStart(2, '0');
      const open = g.isOpen();
      const rep = s.reputation;
      const repCls = rep <= -7 ? 'bad' : rep >= 3 ? 'good' : '';
      const kind = D.demandKind(D.demandAt(s.clock / 60));
      const rush = open ? `<span class="${kind === 'peak' ? 'peak' : kind === 'off' ? 'dim' : ''}">${D.DEMAND_NAMES[kind]}</span>` : '';
      const doom = s.lowDays > 0 ? `　<span class="bad">⚠ 谷底 ${s.lowDays}/${D.REPUTATION.loseDays} 天</span>` : '';
      const html = `第 ${s.day} 天 ${hh}:${mm}・<span class="${open ? 'good' : 'dim'}">${open ? '營業中' : '休息中'}</span>${rush ? '・' + rush : ''}　風評 <b class="${repCls}">${rep > 0 ? '+' : ''}${rep.toFixed(1)}</b>${doom}`;
      if (this.el.clock.innerHTML !== html) this.el.clock.innerHTML = html;
    }

    /** 玩家按暫停／繼續 */
    togglePause() {
      const g = this.game;
      g.setPause('user', !g.isPausedBy('user'));
      RC.audio.sfx('click');
      this.refreshHud();
    }

    /** 暫停提示：玩家手動暫停 > 設定面板 > 裝潢。 */
    updatePauseBadge() {
      const g = this.game;
      const el = this.el.pauseBadge;
      let t = '';
      if (g.isPausedBy('user')) t = '⏸ 已暫停　按 ▶ 或空白鍵繼續';
      else if (g.isPausedBy('settings')) t = '⏸ 設定中：遊戲時間已暫停';
      else if (g.isPausedBy('edit')) t = '⏸ 裝潢中：遊戲時間已暫停';
      el.hidden = !t;
      if (t) this.setText(el, t);
    }

    closePanel(silent) {
      if (!this.panel) return;
      if (this.panel.name === 'settings') this.game.setPause('settings', false); // 關掉設定，遊戲繼續
      if (this.panel.overlay) this.panel.overlay.remove();
      this.panel = null;
      if (!silent) RC.audio.sfx('click');
    }

    renderPanel() {
      const p = this.panel;
      if (!p || !p.overlay || !PANELS[p.name]) return; // 彈出視窗（modal / 升級 / 遊戲終止…）沒有分頁內容要重繪
      const body = p.overlay.querySelector('.win-body');
      const slot = p.overlay.querySelector('.tabs-slot');
      const scroll = body.scrollTop;
      let tabs = null;
      let html = '';
      switch (p.name) {
        case 'shop': tabs = SHOP_TABS; html = this.htmlShop(p.tab); break;
        case 'inv': html = this.htmlInventory(); break;
        case 'menu': html = this.htmlMenu(); break;
        case 'staff': tabs = [{ id: 'crew', name: '員工' }, { id: 'hire', name: '招聘' }, { id: 'sched', name: '排班' }]; html = p.tab === 'sched' ? this.htmlSchedule() : p.tab === 'hire' ? this.htmlRecruit() : this.htmlStaff(); break;
        case 'quest': html = this.htmlQuests(); break;
        case 'settings': tabs = [{ id: 'main', name: '一般' }, { id: 'stats', name: '統計' }, { id: 'data', name: '存檔' }]; html = this.htmlSettings(p.tab); break;
        default:
      }
      const tabsHtml = tabs ? `<div class="tabs">${tabs.map((t) => `<button class="tab ${t.id === p.tab ? 'on' : ''}" data-act="tab" data-tab="${t.id}">${t.name}</button>`).join('')}</div>` : '';
      if (slot.innerHTML !== tabsHtml) slot.innerHTML = tabsHtml;
      // 文字輸入框正在編輯時不要重繪，避免失去焦點
      if (p.name === 'settings' && body.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
      // 內容沒變就不要重繪：重繪會讓正在按下的按鈕被換掉，點擊就會丟失
      if (p.lastHtml === html && p.lastTab === p.tab) return;
      p.lastHtml = html;
      p.lastTab = p.tab;
      body.innerHTML = html;
      body.scrollTop = p.lastTab === p.prevTab ? scroll : 0;
      p.prevTab = p.tab;
    }

    /** 員工面板的即時數值（體力、狀態）原地更新，不重繪結構。 */
    patchStaffPanel() {
      const p = this.panel;
      if (!p || p.name !== 'staff' || !p.overlay) return;
      for (const m of this.game.crew) {
        const q = (k) => p.overlay.querySelector(`[data-${k}="${m.id}"]`);
        const st = q('st');
        if (st) this.setText(st, !m.onDuty ? '下班中' : m.overtime ? '收店加班・' + (STATE_SHORT[m.state] || '') : STATE_SHORT[m.state] || '');
        const bar = q('en');
        if (!bar) continue; // 掌櫃沒有體力條
        bar.style.width = m.rec.energy + '%';
        this.setText(q('entx'), '體力 ' + Math.round(m.rec.energy));
        const feed = q('feed');
        if (feed) feed.disabled = m.rec.energy >= 95;
      }
    }

    owned(id) {
      const s = this.game.s;
      return (s.inventory[id] || 0) + s.items.filter((i) => i.id === id).length;
    }

    htmlShop(tab) {
      const s = this.game.s;
      if (tab === 'floor' || tab === 'wall') return this.htmlThemes(tab);
      if (tab === 'expand') return this.htmlExpand();
      const list = D.furnitureList.filter((f) => f.cat === tab);
      return `<div class="grid">${list
        .map((f) => {
          const locked = s.level < f.level;
          const lack = s.coins < f.price;
          const own = this.owned(f.id);
          return `<div class="card ${locked ? 'locked' : ''}">
            <div class="thumb"><img class="px" src="${AP.furnThumb(f.id, 96)}" width="96" height="96" alt=""></div>
            <div class="nm"><span>${f.name}</span>${own ? `<span class="tag">擁有 ${own}</span>` : ''}</div>
            <div class="ds">${esc(f.desc)}${f.appeal ? `<br>魅力 +${f.appeal}` : ''}${f.speed ? `<br>烹飪速度 ×${f.speed}` : ''}</div>
            <div class="meta"><span class="price ${lack && !locked ? 'lack' : ''}">${ic('coin', 1)}${fmt(f.price)}</span>
            ${locked ? `<span class="tag">${ic('lock', 1)} Lv.${f.level}</span>` : `<button class="btn small primary" data-act="buy-furn" data-id="${f.id}" ${lack ? 'disabled' : ''}>購買</button>`}</div>
          </div>`;
        })
        .join('')}</div>`;
    }

    themeSwatch(kind, id) {
      const key = 'sw:' + kind + id;
      if (!this._sw) this._sw = {};
      if (this._sw[key]) return this._sw[key];
      let c;
      if (kind === 'floor') {
        c = gfx.canvas(96, 48);
        const g = gfx.ctx(c);
        const a = AW.floorTile(id, false);
        const b = AW.floorTile(id, true);
        const pos = [[32, 0], [16, 8], [48, 8], [32, 16], [0, 16], [64, 16], [16, 24], [48, 24], [32, 32]];
        pos.forEach(([x, y], i) => g.drawImage(i % 2 ? b : a, x, y));
      } else {
        const seg = AW.wallSeg(id, 'plain');
        c = gfx.canvas(48, 60);
        const g = gfx.ctx(c);
        for (let i = 0; i < 3; i++) g.drawImage(seg, 0, 8, 16, 52, i * 16, 0, 16, 52);
      }
      return (this._sw[key] = c.toDataURL());
    }

    htmlThemes(kind) {
      const s = this.game.s;
      const list = kind === 'floor' ? D.floorList : D.wallList;
      const own = kind === 'floor' ? s.owned.floors : s.owned.walls;
      return `<div class="grid">${list
        .map((t) => {
          const have = own.includes(t.id);
          const using = s.room[kind] === t.id;
          const locked = !have && s.level < t.level;
          const lack = !have && s.coins < t.price;
          return `<div class="card ${locked ? 'locked' : ''}">
            <div class="thumb"><img class="px" src="${this.themeSwatch(kind, t.id)}" height="64" alt=""></div>
            <div class="nm"><span>${t.name}</span>${using ? '<span class="tag good">使用中</span>' : have ? '<span class="tag">已擁有</span>' : ''}</div>
            <div class="ds">${t.appeal ? `魅力 +${t.appeal}` : '預設款式'}</div>
            <div class="meta">${have ? '<span></span>' : `<span class="price ${lack && !locked ? 'lack' : ''}">${ic('coin', 1)}${fmt(t.price)}</span>`}
            ${locked ? `<span class="tag">${ic('lock', 1)} Lv.${t.level}</span>` : using ? '' : `<button class="btn small primary" data-act="theme" data-kind="${kind}" data-id="${t.id}" ${lack ? 'disabled' : ''}>${have ? '套用' : '購買'}</button>`}</div>
          </div>`;
        })
        .join('')}</div>`;
    }

    htmlExpand() {
      const s = this.game.s;
      return D.expansions
        .map((e, i) => {
          if (i === 0) return '';
          const cur = s.room.stage === i;
          const done = s.room.stage > i;
          const next = s.room.stage + 1 === i;
          const locked = s.level < e.level;
          const lack = s.coins < e.cost;
          return `<div class="row ${done || cur ? '' : next ? 'cur' : 'dim'}">
            <div class="ico">${ic('hammer', 3)}</div>
            <div class="grow"><div class="nm">${e.w} × ${e.h} 格的餐廳</div>
            <div class="sub">${done || cur ? '已完成' : `需要 Lv.${e.level}　費用 ${fmt(e.cost)} 金幣`}　（擴建後家具位置不變，空間往右下延伸）</div></div>
            ${done || cur ? `<span class="tag good">${cur ? '目前' : '已擴建'}</span>` : next ? (locked ? `<span class="tag">${ic('lock', 1)} Lv.${e.level}</span>` : `<button class="btn primary" data-act="expand" ${lack ? 'disabled' : ''}>擴建</button>`) : '<span class="tag">未解鎖</span>'}
          </div>`;
        })
        .join('') + `<div class="row"><div class="ico">${ic('hammer', 3)}</div><div class="grow"><div class="nm">目前：${this.game.room.w} × ${this.game.room.h} 格</div><div class="sub">房間越大，可以放越多桌椅與裝飾。</div></div></div>`;
    }

    htmlInventory() {
      const s = this.game.s;
      const ids = Object.keys(s.inventory);
      if (!ids.length) return `<div class="empty">倉庫是空的。<br>到「商店」買東西，或在裝潢模式把家具「收起」。</div>`;
      return `<div class="grid">${ids
        .map((id) => {
          const f = D.furniture[id];
          return `<div class="card"><div class="thumb"><img class="px" src="${AP.furnThumb(id, 96)}" width="96" height="96" alt=""></div>
            <div class="nm"><span>${f.name}</span><span class="tag">× ${s.inventory[id]}</span></div>
            <div class="meta"><button class="btn small primary" data-act="place-inv" data-id="${id}">放置</button>
            <button class="btn small" data-act="sell-inv" data-id="${id}">賣出 ${ic('coin', 1)}${fmt(Math.floor(f.price / 2))}</button></div></div>`;
        })
        .join('')}</div>`;
    }

    htmlMenu() {
      const g = this.game;
      const s = g.s;
      return `<div class="sub" style="margin:0 3px 4px">客人會從「已學會」的菜色中隨機點餐。同一道菜做得越多，熟練度越高（售價 +8%、烹飪時間 −5% / 級）。</div>` + D.dishList
        .map((d) => {
          const info = g.dishInfo(d.id);
          const locked = s.level < d.level;
          if (info.learned) {
            const next = D.MASTERY_STEPS[info.mastery] || null;
            const stars = Array.from({ length: 5 }, (_, i) => (i < info.mastery ? '★' : `<span class="off">★</span>`)).join('');
            return `<div class="row"><div class="ico"><img class="px" src="${AP.iconURL(d.id, 3, 'dish')}" width="36" height="36" alt=""></div>
              <div class="grow"><div class="nm">${d.name} <span class="mastery">${stars}</span></div>
              <div class="sub">售價 ${ic('coin', 1)}${info.price}　烹飪 ${d.cook}s　已烹飪 ${fmt(info.cooked)} 次${next ? `（下一級 ${next} 次）` : '（熟練度最高）'}</div></div></div>`;
          }
          const lack = s.coins < d.learn;
          return `<div class="row ${locked ? 'dim' : ''}"><div class="ico"><img class="px" src="${AP.iconURL(d.id, 3, 'dish')}" width="36" height="36" alt="" style="${locked ? 'filter:brightness(0.2)' : ''}"></div>
            <div class="grow"><div class="nm">${locked ? '？？？' : d.name}</div><div class="sub">${locked ? `Lv.${d.level} 解鎖` : `售價 ${ic('coin', 1)}${d.price}　烹飪 ${d.cook}s`}</div></div>
            ${locked ? `<span class="tag">${ic('lock', 1)} Lv.${d.level}</span>` : `<button class="btn primary" data-act="learn" data-id="${d.id}" ${lack ? 'disabled' : ''}>學習 ${ic('coin', 1)}${fmt(d.learn)}</button>`}</div>`;
        })
        .join('');
    }

    /** 員工分頁：目前的店掌櫃與員工（日薪、欠薪、班別、體力） */
    htmlStaff() {
      const g = this.game;
      const s = g.s;
      const cap = D.maxStaffForLevel(s.level);
      const hired = s.staff.filter((m) => !m.boss).length;
      const totalWage = s.staff.reduce((n, m) => n + (m.wage || 0), 0);
      const row = (m) => {
        if (m.boss) {
          return `<div class="row cur"><div class="ico"><img class="px" src="${avatar(m.look, true, true)}" width="30" height="54" alt=""></div>
            <div class="grow"><div class="nm">${esc(m.name)} <span class="tag gold">店掌櫃・你</span> <span class="tag" data-st="${m.id}"></span></div>
            <div class="sub">速度 ${m.speed.toFixed(2)}　技術 ${m.skill.toFixed(2)}　不會累，也不能開除，不用領薪水</div>
            <div class="sub">班別 ${shiftText(m.shift)}（每天最多 ${D.DAY.shiftHours} 小時）</div>
            <div class="sub">什麼都會做：點餐、煮菜、上菜、收桌子、洗碗。<b>客人用餐後的結帳（電子支付）只有他能處理</b>。</div></div>
            <div><button class="btn small" data-act="boss-rename">改名</button></div></div>`;
        }
        return `<div class="row"><div class="ico"><img class="px" src="${avatar(m.look, true)}" width="30" height="54" alt=""></div>
            <div class="grow"><div class="nm">${esc(m.name)} <span class="tag gold">Lv.${m.level}</span>${m.manager ? ' <span class="tag blue">值班店長</span>' : ''} <span class="tag" data-st="${m.id}"></span></div>
            <div class="sub">速度 ${m.speed.toFixed(2)}　技術 ${m.skill.toFixed(2)}　班別 ${shiftText(m.shift)}</div>
            <div class="sub">日薪 ${ic('coin', 1)}${fmt(m.wage)}${m.unpaid > 0 ? ` <span class="bad">⚠ 已 ${m.unpaid} 天沒領到薪水</span>` : ''}</div>
            <div class="bar energy" style="max-width:180px"><i data-en="${m.id}" style="width:0"></i></div><div class="bar-label" data-entx="${m.id}"></div></div>
            <div><button class="btn small" data-act="feed" data-id="${m.id}" data-feed="${m.id}">${ic('bolt', 1)}餵食 ${D.FEED_COST}</button>
            ${m.manager ? `<button class="btn small" data-act="clear-manager">解除店長</button>` : m.level >= D.DAY.managerLevel ? `<button class="btn small blue" data-act="set-manager" data-id="${m.id}">任命值班店長</button>` : ''}
            <button class="btn small danger" data-act="fire" data-id="${m.id}">解雇</button></div></div>`;
      };
      const cur = [...s.staff].sort((a, b) => (b.boss ? 1 : 0) - (a.boss ? 1 : 0)).map(row).join('');
      return `<div class="section-title" style="margin-top:0">店掌櫃 + 員工 ${hired} / ${cap}${hired >= cap ? '（升級可增加名額）' : ''}</div>${cur}
        <div class="sub" style="margin:6px 3px">每天午夜發日薪，合計 ${ic('coin', 1)}<b>${fmt(totalWage)}</b>；金幣不夠發的員工會累積欠薪，連續 ${D.WAGE_QUIT_DAYS} 天領不到就會辭職。</div>
        <div class="sub" style="margin:6px 3px">員工負責點餐、煮菜、上菜、收桌子與洗碗（不能收金幣；Lv.${D.DAY.managerLevel} 以上可任命為值班店長，能代替掌櫃收款）。速度影響走路與動作，技術影響烹飪時間。體力耗盡會自動休息，也可以花錢餵食立刻恢復。</div>
        <div class="sub" style="margin:6px 3px">想找新人，到「招聘」分頁。</div>`;
    }

    /** 招聘分頁：應徵者與日薪（雇用不用先付錢，之後每天發薪） */
    htmlRecruit() {
      const s = this.game.s;
      const cap = D.maxStaffForLevel(s.level);
      const hired = s.staff.filter((m) => !m.boss).length;
      const canHire = hired < cap;
      const totalWage = s.staff.reduce((n, m) => n + (m.wage || 0), 0);
      const cands = s.candidates
        .map((c, i) => {
          const wage = RC.state.dailyWage(c, s.staff.length);
          const lack = s.coins < wage;
          return `<div class="row"><div class="ico"><img class="px" src="${avatar(c.look, true)}" width="30" height="54" alt=""></div>
            <div class="grow"><div class="nm">${esc(c.name)}</div><div class="sub">速度 ${c.speed.toFixed(2)}　技術 ${c.skill.toFixed(2)}</div>
            <div class="sub">日薪 ${ic('coin', 1)}<b>${fmt(wage)}</b> / 天${lack ? ' <span class="bad">（手上至少要有一天的薪水）</span>' : ''}</div></div>
            <button class="btn primary" data-act="hire" data-idx="${i}" ${!canHire || lack ? 'disabled' : ''}>雇用</button></div>`;
        })
        .join('');
      return `<div class="section-title" style="margin-top:0">應徵者　<button class="btn small" data-act="refresh-cands">重新徵才 ${ic('coin', 1)}30</button></div>
        <div class="sub" style="margin:0 3px 4px">員工名額 ${hired} / ${cap}${canHire ? '' : '（已額滿，升級可增加名額）'}　現有員工日薪合計 ${ic('coin', 1)}${fmt(totalWage)} / 天</div>
        ${cands}
        <div class="sub" style="margin:6px 3px;line-height:1.6">雇用<b>不用先付錢</b>，改成每天午夜發<b>日薪</b>（店掌櫃不領薪水）。手上要有至少一天的薪水才能雇；之後金幣不夠發的員工會累積欠薪，連續 ${D.WAGE_QUIT_DAYS} 天領不到薪水就會辭職。能力越強、人數越多，日薪越高。</div>`;
    }

    /** 排班：營業時間、自動排班、每位員工的班別與 24 小時覆蓋 */
    htmlSchedule() {
      const g = this.game;
      const s = g.s;
      const sc = s.schedule;
      const cov = g.coverage();
      const opt = (from, to, sel) => Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${hhmm(h)}</option>`).join('');
      const bar = (cells) => `<div class="h24">${cells.join('')}</div>`;
      const covBar = bar(
        cov.staff.map((n, h) => {
          const bad = cov.open[h] && (n === 0 || cov.payers[h] === 0);
          return `<i class="${cov.open[h] ? 'open ' : ''}${bad ? 'bad' : n ? 'ok' : ''}" title="${hhmm(h)}：${n} 人在班，${cov.payers[h]} 人能收款"></i>`;
        })
      );
      const demandBar = bar(
        D.DEMAND.map((v, h) => {
          const kind = D.demandKind(v);
          const a = Math.min(1, 0.12 + (v / 1.6) * 0.88).toFixed(2);
          return `<i class="${cov.open[h] ? 'open' : ''}" style="background-color:rgba(232,134,58,${a})" title="${hhmm(h)}：客流 ×${v.toFixed(1)}（${D.DEMAND_NAMES[kind]}）"></i>`;
        })
      );
      // 尖峰時段（連續的整點合併成一段）
      const peakRanges = [];
      for (let h = 0; h < 24; h++) {
        if (D.demandKind(D.DEMAND[h]) !== 'peak') continue;
        const last = peakRanges[peakRanges.length - 1];
        if (last && last[1] === h) last[1] = h + 1;
        else peakRanges.push([h, h + 1]);
      }
      const peakText = peakRanges.map(([a, b]) => `${hhmm(a)}–${hhmm(b)}`).join('、');
      const thin = [];
      for (let h = 0; h < 24; h++) if (cov.open[h] && D.demandKind(D.DEMAND[h]) === 'peak' && s.staff.length >= 2 && cov.staff[h] < 2) thin.push(h);
      const gaps = [];
      for (let h = 0; h < 24; h++) if (cov.open[h] && cov.staff[h] === 0) gaps.push(h);
      const noPay = [];
      for (let h = 0; h < 24; h++) if (cov.open[h] && cov.staff[h] > 0 && cov.payers[h] === 0) noPay.push(h);
      const fmtH = (a) => a.map((h) => hhmm(h)).join('、');
      const warns = [];
      if (gaps.length) warns.push(`營業時間內 ${fmtH(gaps)} 沒有人在班，客人進不了門。`);
      if (thin.length) warns.push(`尖峰時段 ${fmtH(thin)} 只有 1 人在班，客人一多就會排隊流失，建議把其他人的班排進來。`);
      if (noPay.length) warns.push(`${fmtH(noPay)} 在班的人裡沒有店掌櫃或值班店長，客人只能自助結帳（風評較差）。`);
      const rows = [...s.staff]
        .sort((a, b) => (b.boss ? 1 : 0) - (a.boss ? 1 : 0))
        .map((m) => {
          const cells = Array.from({ length: 24 }, (_, h) => `<i class="${(((h - m.shift) % 24) + 24) % 24 < D.DAY.shiftHours ? 'ok' : ''} ${cov.open[h] ? 'open' : ''}"></i>`);
          return `<div class="row"><div class="ico"><img class="px" src="${avatar(m.look, true, m.boss)}" width="30" height="54" alt=""></div>
            <div class="grow"><div class="nm">${esc(m.name)} ${m.boss ? '<span class="tag gold">店掌櫃</span>' : m.manager ? '<span class="tag blue">值班店長</span>' : `<span class="tag gold">Lv.${m.level}</span>`}</div>
            <div class="sub">上班 <select data-sel="shift" data-id="${m.id}" aria-label="${esc(m.name)}的上班時間">${opt(0, 23, m.shift)}</select> 起連續 ${D.DAY.shiftHours} 小時（到 ${hhmm(m.shift + D.DAY.shiftHours)}）</div>
            ${bar(cells)}</div></div>`;
        })
        .join('');
      return `<div class="section-title" style="margin-top:0">營業時間</div>
        <div class="sched-row">開店 <select data-sel="open" aria-label="開店時間">${opt(0, 23, sc.open)}</select> 打烊 <select data-sel="close" aria-label="打烊時間">${opt(1, 24, sc.close)}</select>
          <span class="sub">共 ${sc.close - sc.open} 小時；其餘時間是休息時間，客人不會上門</span></div>
        <div class="section-title">排班</div>
        <div class="sched-row"><button class="btn small ${sc.auto ? 'primary' : ''}" data-act="auto-sched">自動排班：${sc.auto ? '開' : '關'}</button>
          <span class="sub">${sc.auto ? '開啟時，班表會跟著營業時間與人員自動調整' : '手動排班：自己決定每個人幾點上班'}</span></div>
        <div class="sub" style="margin:4px 0">友善職場：每位員工（包含店掌櫃）每天排定上班 ${D.DAY.shiftHours} 小時，離開崗位休息滿 ${D.DAY.restFullHours} 小時，體力會自動恢復。</div>
        <div class="sub" style="margin:4px 0">打烊時店裡還有客人、桌上有餐具或洗碗槽有髒盤子，班表剛好結束的員工會<b>留下來收店</b>：客人吃完、結帳、餐具洗完才下班（最多加班 ${D.DAY.closeOvertimeMin / 60} 小時）。營業時間還沒結束就到點的班，照樣準時下班。</div>
        <div class="sub">各時段在班人數（亮格＝營業時間，紅色＝缺人或沒人能收款）</div>${covBar}
        <div class="h24-labels"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
        <div class="sub" style="margin-top:8px">客人上門的頻率（顏色越深客人越多；亮格＝營業時間）</div>${demandBar}
        <div class="h24-labels"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
        <div class="sub">尖峰時段：${peakText}；下午與深夜是離峰，客人少。尖峰時客人比較有耐心排隊，客滿走掉的風評扣分也減半。</div>
        ${warns.map((w) => `<div class="warn-line">⚠ ${w}</div>`).join('')}
        <div class="section-title">班表</div>${rows}`;
    }

    htmlQuests() {
      const g = this.game;
      const i0 = g.s.quest.i;
      return D.quests
        .map((q, i) => {
          const done = i < i0;
          const cur = i === i0;
          const prog = cur ? g.questProgress(q) : done ? q.n : 0;
          const pct = Math.min(100, Math.round((prog / q.n) * 100));
          return `<div class="row ${cur ? 'cur' : done ? '' : 'dim'}"><div class="ico">${ic(done ? 'check' : 'scroll', 3)}</div>
            <div class="grow"><div class="nm">${i + 1}. ${esc(q.text)}</div>
            <div class="sub">獎勵 ${ic('coin', 1)}${fmt(q.reward)}${cur || done ? `　${fmt(Math.min(prog, q.n))} / ${fmt(q.n)}` : ''}</div>
            ${cur ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>
            ${cur && prog >= q.n ? '<button class="btn primary" data-act="claim">領取</button>' : done ? '<span class="tag good">完成</span>' : ''}</div>`;
        })
        .join('') + (i0 >= D.quests.length ? '<div class="empty">全部任務完成！你是傳說中的餐廳老闆 🎉</div>' : '');
    }

    htmlSettings(tab) {
      const g = this.game;
      const s = g.s;
      const A = RC.audio;
      if (tab === 'stats') {
        const t = s.stats;
        const mins = Math.floor(t.playTime / 60);
        return `<div class="kv">
          <span>餐廳等級</span><b>Lv.${s.level}</b>
          <span>餐廳星級（最高三星）</span><b>${D.STAR_TITLES[g.stars]}</b>
          <span>服務客人</span><b>${fmt(t.served)} 位</b>
          <span>氣走的客人</span><b>${fmt(t.angry)} 位</b>
          <span>沒等到位子離開</span><b>${fmt(t.walkouts || 0)} 組</b>
          <span>累計賺取</span><b>${fmt(t.earned)} 金幣</b>
          <span>累計小費</span><b>${fmt(t.tips)} 金幣</b>
          <span>遊戲版次</span><b>${D.GAME_VERSION.current}</b>
          <span>營業天數</span><b>第 ${s.day} 天</b>
          <span>餐廳風評</span><b>${s.reputation > 0 ? '+' : ''}${s.reputation.toFixed(1)}（${D.REPUTATION.min} ~ +${D.REPUTATION.max}）</b>
          <span>員工人數</span><b>${s.staff.length} 位</b>
          <span>每日薪資合計</span><b>${fmt(s.staff.reduce((n, m) => n + (m.wage || 0), 0))} 金幣</b>
          <span>座位數</span><b>${g.seats.length}</b>
          <span>遊玩時間</span><b>${Math.floor(mins / 60)} 小時 ${mins % 60} 分</b></div>`;
      }
      if (tab === 'data') {
        const txt = esc(RC.state.serialize(s));
        return `<div class="sub">進度會自動存在這個瀏覽器裡。想換裝置或備份，可以複製下面的存檔文字（已編碼，不能手動修改）；在另一台貼上「匯入」即可。</div>
          <div class="section-title">匯出</div><textarea id="export" readonly>${txt}</textarea>
          <button class="btn small" data-act="copy-save">複製存檔</button>
          <div class="section-title">匯入</div><textarea id="import" placeholder="把存檔文字貼在這裡"></textarea>
          <button class="btn small blue" data-act="import-save">匯入並重新載入</button>
          <div class="section-title">危險區</div><button class="btn small danger" data-act="reset">重新開始（清除存檔）</button>`;
      }
      const boss = s.staff.find((m) => m.boss);
      return `<div class="section-title" style="margin-top:0">餐廳名稱</div>
        <div style="display:flex;gap:6px;align-items:center"><input type="text" id="rn" maxlength="12" value="${esc(s.name)}"><button class="btn small primary" data-act="rename">儲存</button></div>
        <div class="section-title">店掌櫃的名字（就是你）</div>
        <div style="display:flex;gap:6px;align-items:center"><input type="text" id="bn" maxlength="8" value="${esc(boss ? boss.name : '')}"><button class="btn small primary" data-act="rename-boss">儲存</button></div>
        <div class="section-title">聲音</div>
        <div class="vol-row"><button class="btn small ${A.sfxOn ? 'primary' : ''}" data-act="toggle-sfx">音效：${A.sfxOn ? '開' : '關'}</button>
          <input type="range" min="0" max="100" value="${Math.round(A.sfxVol * 100)}" data-vol="sfx" aria-label="音效音量"><span class="vol-label" data-vol-label>${Math.round(A.sfxVol * 100)}%</span></div>
        <div class="vol-row"><button class="btn small ${A.musicOn ? 'primary' : ''}" data-act="toggle-music">音樂：${A.musicOn ? '開' : '關'}</button>
          <input type="range" min="0" max="100" value="${Math.round(A.musicVol * 100)}" data-vol="music" aria-label="音樂音量"><span class="vol-label" data-vol-label>${Math.round(A.musicVol * 100)}%</span></div>
        <div class="sub">音效和音樂是兩個獨立的開關與音量，右上角也各有一顆按鈕。瀏覽器需要先點擊一下頁面才能出聲。</div>
        <div class="section-title">遊戲速度</div>
        ${[1, 2, 3].map((v) => `<button class="btn small ${g.speed === v ? 'primary' : ''}" data-act="speed" data-v="${v}">×${v}</button>`).join('')}
        <div class="section-title">操作說明</div>
        <div class="sub" style="line-height:1.7">客人吃完頭上會出現金幣，店掌櫃會過去用電子支付收款（點那位客人可以請掌櫃優先處理）· 點擊員工／客人查看狀態<br>「裝潢」模式：點選家具後可旋轉、移動（也可直接拖曳）、收起、賣出<br>快捷鍵：E 裝潢　R 旋轉　Esc 取消　Delete 收起　1/2/3 速度</div>`;
    }

    /* ───────── 彈出視窗 ───────── */

    modal(html, cls) {
      this.closePanel(true);
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.innerHTML = `<div class="win pbox ${cls || 'narrow'}"><div class="win-body">${html}</div></div>`;
      this.modalRoot.appendChild(overlay);
      this.panel = { name: 'modal', overlay };
      return overlay;
    }

    showWelcome() {
      const boss = this.game.s.staff.find((m) => m.boss);
      this.modal(`<div class="welcome"><h3 style="margin:0 0 6px;font-size:20px">歡迎來到像素餐廳城！</h3>
        <p>你的小吃店今天開張了。你就是店裡的<b>店掌櫃</b>，把它經營成傳說中的名店吧！</p>
        <ul><li>客人有單人也有成群來，<b>不同組不併桌</b>；沒空桌就在門外候位</li>
        <li>員工與掌櫃會點餐、煮菜、上菜，客人走後桌上會留下餐具，要收拾完才能再坐</li>
        <li>客人吃完頭上會出現金幣，<b>店掌櫃會走到他面前電子支付收款</b>（只有他能收）；收完款客人才會離開、座位才會空出來</li>
        <li>餐廳有<b>營業時間與休息時間</b>；每位員工每天最多上班 8 小時，可以到「員工 → 排班」自己排或交給自動排班</li>
        <li>用過的餐具要先送到<b>洗碗槽</b>洗乾淨才有盤子能用；風評連續 15 天跌到谷底，餐廳就會倒閉</li>
        <li>到「商店」買桌椅、爐灶與裝飾，椅子要<b>緊鄰桌子</b></li>
        <li>到「菜單」學新菜色，「員工 → 招聘」找幫手（雇用不用先付錢，每天午夜發<b>日薪</b>）；進度會自動存檔，離開期間也會替你賺錢</li></ul>
        <div class="section-title" style="margin-top:6px">幫你的店掌櫃取個名字</div>
        <input type="text" id="bn0" maxlength="8" value="${esc(boss ? boss.name : '')}">
        <div style="text-align:center;margin-top:6px"><button class="btn primary" data-act="welcome-ok">開始營業！</button></div></div>`);
    }

    /** 存檔版次與目前遊戲差太多：只能重新開局 */
    showVersionBlocked(chk) {
      const cur = D.GAME_VERSION.current;
      const old = chk && chk.reason === 'new';
      this._skipSave = true;
      this.modal(`<div class="lvup"><h2 style="font-size:20px">存檔版次不相容</h2>
        <div>這份存檔是遊戲<b>版次 ${chk ? esc(chk.version) : '?'}</b>，目前遊戲是<b>版次 ${cur}</b>。${old ? '存檔比目前的遊戲還新，請重新整理頁面載入最新版。' : '版次差太多，沒辦法安全地轉換，只能請你重新開局。'}</div>
        <div class="sub">舊存檔已另外備份在瀏覽器裡，不會被覆蓋。</div>
        <div style="margin-top:8px"><button class="btn primary" data-act="version-new">開始新遊戲</button></div></div>`);
      this.panel.name = 'versionblock';
    }

    showGameOver() {
      const o = this.game.s.over;
      if (!o) return;
      const why = o.reason === 'reputation' ? `餐廳的風評連續 ${D.REPUTATION.loseDays} 天跌到谷底（${D.REPUTATION.min}），客人再也不願意上門了。` : '餐廳無法再經營下去了。';
      this.modal(`<div class="lvup"><h2 style="font-size:22px">餐廳倒閉了…</h2>
        <div>${why}</div>
        <div class="list"><div>✦ 撐了 <b>${o.day}</b> 天</div><div>✦ 服務過 <b>${fmt(o.served)}</b> 位客人</div><div>✦ 累計賺了 ${ic('coin', 1)} <b>${fmt(o.earned)}</b></div><div>✦ 餐廳等級 <b>Lv.${o.level}</b></div></div>
        <div class="sub">下次記得多請人手、排好班表、顧好餐點與環境，讓客人滿意。</div>
        <div style="margin-top:8px"><button class="btn primary" data-act="restart">重新開始</button><button class="btn" data-act="gameover-close">回去看看</button></div></div>`);
      this.panel.name = 'gameover';
    }

    showBossRename(reopenStaff) {
      const boss = this.game.s.staff.find((m) => m.boss);
      this._reopenStaff = !!reopenStaff;
      this.modal(`<div class="section-title" style="margin-top:0">店掌櫃的名字</div>
        <input type="text" id="bn2" maxlength="8" value="${esc(boss ? boss.name : '')}">
        <div style="text-align:center;margin-top:8px"><button class="btn primary" data-act="boss-save">儲存</button><button class="btn" data-act="boss-cancel">取消</button></div>`);
      setTimeout(() => {
        const i = document.getElementById('bn2');
        if (i) i.select();
      }, 30);
    }

    /** 離開一段時間後回來的報告 */
    showOffline(r) {
      if (!r || !r.show) return;
      const mins = Math.round(r.away / 60);
      const dur = mins >= 60 ? `${Math.floor(mins / 60)} 小時 ${mins % 60} 分` : `${mins} 分鐘`;
      const lines = [];
      if (r.days > 0) lines.push(`店裡度過了 <b>${r.days}</b> 天，風評現在是 <b>${r.reputation > 0 ? '+' : ''}${r.reputation.toFixed(1)}</b>`);
      lines.push(`服務了 <b>${fmt(r.served)}</b> 位客人`);
      if (r.earned > 0) lines.push(`店掌櫃替客人收了 ${ic('coin', 1)} <b>${fmt(r.earned)}</b>`);
      if (r.levelTo > r.levelFrom) lines.push(`餐廳升到 <b>Lv.${r.levelTo}</b>，獲得升級獎勵 ${ic('coin', 1)} ${fmt(r.levelReward)}`);
      if (r.walkouts + r.angry > 0) lines.push(`${fmt(r.walkouts + r.angry)} 組客人沒吃到就走了（桌椅或人手不足）`);
      const note = r.capped ? '離開太久了，最多只計算 8 小時。' : '';
      this.modal(`<div class="lvup"><h2 style="font-size:22px">歡迎回來！</h2>
        <div>你離開了 ${dur}，店裡一直有人照看</div>
        <div class="list">${lines.map((l) => `<div>✦ ${l}</div>`).join('')}</div>
        <div class="sub">離線時只以 ${Math.round(D.OFFLINE.efficiency * 100)}% 的效率營業。${note}</div>
        <div style="margin-top:8px"><button class="btn primary" data-act="lvup-ok">收下</button></div></div>`);
      this.panel.name = 'levelup';
      RC.audio.sfx('quest');
    }

    showLevelUp() {
      const e = this.lvQueue.shift();
      if (!e) return;
      const u = e.unlocks;
      const lines = [];
      if (u.dishes.length) lines.push(`新菜色：${u.dishes.map((d) => d.name).join('、')}`);
      if (u.furniture.length) lines.push(`新商品：${u.furniture.map((f) => f.name).join('、')}`);
      if (u.floors.length || u.walls.length) lines.push(`新裝潢：${[...u.floors, ...u.walls].map((f) => f.name).join('、')}`);
      if (u.expansions.length) lines.push('可以擴建餐廳了！');
      if (u.staffSlot) lines.push('員工名額 +1');
      this.modal(`<div class="lvup"><h2>升級！Lv.${e.level}</h2>
        <div>獲得獎勵 ${ic('coin', 2)} <b>${fmt(e.reward)}</b></div>
        ${lines.length ? `<div class="list">${lines.map((l) => `<div>✦ ${esc(l)}</div>`).join('')}</div>` : ''}
        <div><button class="btn primary" data-act="lvup-ok">太棒了</button></div></div>`);
      this.panel.name = 'levelup';
    }

    confirm(msg, onYes) {
      this._yes = onYes;
      this.modal(`<div style="text-align:center;line-height:1.6;padding:6px 0 12px">${esc(msg)}</div>
        <div style="text-align:center"><button class="btn danger" data-act="yes">確定</button><button class="btn" data-act="no">取消</button></div>`);
    }

    /* ───────── 動作分派 ───────── */

    act(name, el) {
      const g = this.game;
      const A = RC.audio;
      const id = el && el.dataset.id;
      const res = (r, okSfx) => {
        if (!r.ok) {
          A.sfx('error');
          this.toast(r.msg, 'bad');
        } else A.sfx(okSfx || 'click');
        return r;
      };
      switch (name) {
        case 'close': this.closePanel(); break;
        case 'tab':
          this.panel.tab = el.dataset.tab;
          A.sfx('click');
          this.renderPanel();
          break;
        case 'open-shop': this.openPanel('shop'); A.sfx('click'); break;
        case 'open-inv': this.openPanel('inv'); A.sfx('click'); break;
        case 'open-menu': this.openPanel('menu'); A.sfx('click'); break;
        case 'open-staff': this.openPanel('staff'); A.sfx('click'); break;
        case 'open-quest': this.openPanel('quest'); A.sfx('click'); break;
        case 'open-settings': this.openPanel('settings'); A.sfx('click'); break;
        case 'toggle-edit': A.sfx('click'); this.setEdit(!this.edit); break;
        case 'buy-furn': {
          const r = res(g.buyFurniture(id), 'buy');
          if (r.ok) {
            this.closePanel(true);
            this.startPlacing(id);
            this.toast('點擊餐廳格子來擺放，R 可旋轉');
          }
          break;
        }
        case 'place-inv': this.closePanel(true); this.startPlacing(id); break;
        case 'sell-inv': res(g.sellFromInventory(id), 'coin'); break;
        case 'learn': res(g.learnDish(id), 'buy'); break;
        case 'theme': res(g.buyTheme(el.dataset.kind, id), 'buy'); this.view.layout(); break;
        case 'expand': {
          const r = res(g.expand(), 'levelup');
          if (r.ok) {
            this.view.layout();
            this.toast('餐廳變大了！', 'good');
          }
          break;
        }
        case 'hire': res(g.hire(+el.dataset.idx), 'buy'); break;
        case 'refresh-cands': res(g.refreshCandidates(), 'click'); break;
        case 'fire': {
          const m = g.s.staff.find((x) => x.id === +id);
          if (m)
            this.confirm(`確定要解雇「${m.name}」嗎？`, () => {
              res(g.fire(+id), 'click');
              this.openPanel('staff');
            });
          break;
        }
        case 'feed': res(g.feed(+id), 'buy'); break;
        case 'claim': res(g.claimQuest(), 'quest'); break;
        case 'rename-boss': {
          const v = document.getElementById('bn');
          if (v) res(g.renameBoss(v.value), 'click');
          break;
        }
        case 'auto-sched': res(g.setAutoSchedule(!g.s.schedule.auto), 'click'); break;
        case 'set-manager': res(g.assignManager(+id), 'buy'); break;
        case 'clear-manager': res(g.clearManager(), 'click'); break;
        case 'boss-rename': this.showBossRename(true); A.sfx('click'); break;
        case 'boss-save': {
          const v = document.getElementById('bn2');
          const r = v ? res(g.renameBoss(v.value), 'buy') : { ok: false };
          if (r.ok) {
            this.closePanel(true);
            if (this._reopenStaff) this.openPanel('staff');
          }
          break;
        }
        case 'boss-cancel':
          this.closePanel(true);
          if (this._reopenStaff) this.openPanel('staff');
          break;
        case 'rename': {
          const v = document.getElementById('rn');
          if (v) res(g.renameRestaurant(v.value), 'click');
          break;
        }
        case 'toggle-sfx': A.setSfx(!A.sfxOn); this.persistAudio(); A.sfx('click'); this.refreshHud(); this.renderPanel(); break;
        case 'toggle-music': A.unlock(); A.setMusic(!A.musicOn); this.persistAudio(); this.refreshHud(); this.renderPanel(); break;
        case 'speed': this.setSpeed(+el.dataset.v); break;
        case 'copy-save': {
          const t = document.getElementById('export');
          if (t) {
            t.select();
            try {
              (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(() => this.toast('已複製存檔', 'good'), () => document.execCommand && document.execCommand('copy'));
            } catch (e) {
              /* 手動複製 */
            }
          }
          break;
        }
        case 'import-save': {
          const t = document.getElementById('import');
          try {
            const st = RC.state.parse(t.value.trim());
            this.confirm('匯入會覆蓋目前進度，確定嗎？', () => {
              RC.state.save(st);
              this._skipSave = true;
              location.reload();
            });
          } catch (e) {
            A.sfx('error');
            this.toast(e && e.code === 'version' ? `這份存檔是版次 ${e.check.version}，目前遊戲是版次 ${D.GAME_VERSION.current}，${e.check.reason === 'new' ? '存檔比較新，請更新遊戲' : '版次差太多，無法匯入'}` : '存檔格式不正確', 'bad');
          }
          break;
        }
        case 'version-new':
          this._skipSave = false;
          this.closePanel(true);
          this.showWelcome();
          A.sfx('buy');
          break;
        case 'restart':
          RC.state.clear();
          this._skipSave = true;
          location.reload();
          break;
        case 'gameover-close': this.closePanel(true); break;
        case 'reset':
          this.confirm('確定要清除所有進度重新開始嗎？此動作無法復原。', () => {
            RC.state.clear();
            this._skipSave = true;
            location.reload();
          });
          break;
        case 'welcome-ok': {
          const v = document.getElementById('bn0');
          if (v && v.value.trim()) g.renameBoss(v.value);
          g.s.flags.welcomed = true;
          this.closePanel();
          A.sfx('buy');
          break;
        }
        case 'lvup-ok':
          this.closePanel(true);
          if (this.lvQueue.length) this.showLevelUp();
          break;
        case 'yes': { const f = this._yes; this.closePanel(true); this._yes = null; f && f(); break; }
        case 'no': this.closePanel(); break;
        case 'item-rotate': this.rotateSelected(); break;
        case 'item-move': {
          const it = g.s.items.find((i) => i.uid === this.view.selectedItem);
          if (it) this.startPlacing(it.id, it.uid, it.rot);
          break;
        }
        case 'item-store': this.storeSelected(); break;
        case 'item-sell': {
          const r = res(g.sellItem(this.view.selectedItem), 'coin');
          if (r.ok) this.deselect();
          break;
        }
        case 'rush-pay': {
          const r = g.rushPay(+id);
          if (!r.ok) {
            A.sfx('error');
            this.toast(r.msg, 'bad');
          } else {
            A.sfx('click');
            this.toast('掌櫃會優先去結帳', 'good');
          }
          break;
        }
        case 'actor-close': this.actor = null; this.view.selectedActor = null; this.updateActor(true); break;
        default:
      }
    }

    persistAudio() {
      const s = this.game.s;
      s.settings.sound = RC.audio.sfxOn;
      s.settings.music = RC.audio.musicOn;
      s.settings.sfxVol = RC.audio.sfxVol;
      s.settings.musicVol = RC.audio.musicVol;
    }

    setSpeed(v) {
      this.game.speed = v;
      this.game.s.settings.speed = v;
      this.refreshHud();
      if (this.panel && this.panel.name === 'settings') this.renderPanel();
    }

    /* ───────── 編輯模式 ───────── */

    setEdit(on) {
      this.edit = on;
      this.view.edit = on;
      // 裝潢時遊戲時間暫停：客人、員工、計時全部凍結，慢慢擺不怕客人氣走
      this.game.setPause('edit', on);
      if (!on) {
        this.cancelPlacing();
        this.deselect();
      } else {
        this.actor = null;
        this.view.selectedActor = null;
        this.updateActor(true);
      }
      this.el.bottom.hidden = on;
      this.el.editbar.hidden = !on;
      this.el.quest.classList.toggle('edit-hide', on); // 裝潢時收起任務卡，別擋住上視圖
      this.updateEditHint();
      this.updatePauseBadge();
    }

    updateEditHint() {
      let t = '上視圖：點選家具可移動、旋轉、收起或賣出';
      if (this.placing) t = '點擊格子放置　R 旋轉　Esc 取消';
      else if (this.view.selectedItem != null) t = '拖曳家具或用工具列操作';
      this.setText(this.el.edithint, t);
    }

    startPlacing(id, fromUid, rot) {
      if (!this.edit) this.setEdit(true);
      this.deselect();
      const def = D.furniture[id];
      this.placing = { id, rot: rot != null ? rot : 0, fromUid: fromUid || null, drag: false, def };
      this.updateGhost();
      this.updateEditHint();
      document.getElementById('game').classList.add('placing');
    }

    cancelPlacing() {
      this.placing = null;
      this.view.ghost = null;
      document.getElementById('game').classList.remove('placing');
      this.updateEditHint();
    }

    updateGhost() {
      const p = this.placing;
      if (!p) return;
      const { x, y } = this.hover;
      if (x < -50) {
        this.view.ghost = null;
        return;
      }
      const ok = RC.world.canPlace(this.game.grid, p.def, x, y, p.rot, p.fromUid).ok;
      this.view.ghost = { id: p.id, rot: p.rot, tx: x, ty: y, ok };
    }

    rotateSelected() {
      const g = this.game;
      if (this.placing) {
        this.placing.rot = (this.placing.rot + 1) & 3;
        this.updateGhost();
        RC.audio.sfx('click');
      } else if (this.view.selectedItem != null) {
        const r = g.rotateItem(this.view.selectedItem);
        RC.audio.sfx(r.ok ? 'place' : 'error');
      }
    }

    storeSelected() {
      const uid = this.view.selectedItem;
      if (uid == null) return;
      const r = this.game.storeItem(uid);
      RC.audio.sfx(r.ok ? 'place' : 'error');
      if (r.ok) {
        this.toast('已收進倉庫');
        this.deselect();
      }
    }

    select(uid) {
      this.view.selectedItem = uid;
      this.updateEditHint();
      this.updateItemTool(true);
    }
    deselect() {
      this.view.selectedItem = null;
      this.updateEditHint();
      this.el.itemtool.hidden = true;
    }

    updateItemTool(force) {
      const el = this.el.itemtool;
      const uid = this.view.selectedItem;
      const it = uid != null && !this.placing && this.edit ? this.game.s.items.find((i) => i.uid === uid) : null;
      if (!it) {
        if (!el.hidden) el.hidden = true;
        if (uid != null && !this.game.s.items.some((i) => i.uid === uid)) this.view.selectedItem = null;
        return;
      }
      const def = D.furniture[it.id];
      const fp = RC.world.footprint(def, it.rot);
      const pos = this.view.tileToCss(it.x + fp.w / 2, it.y + fp.h / 2, 34);
      el.style.left = Math.max(110, Math.min(this.view.cssW - 110, pos.x)) + 'px';
      el.style.top = Math.max(96, pos.y - 6) + 'px';
      if (el.hidden || force) {
        el.hidden = false;
        const canRotate = def.rot || def.cat === 'chair';
        el.innerHTML = `${canRotate ? '<button class="btn" data-act="item-rotate">↻ 旋轉</button>' : ''}<button class="btn" data-act="item-move">移動</button><button class="btn" data-act="item-store">收起</button><button class="btn danger" data-act="item-sell">賣 ${fmt(Math.floor(def.price / 2))}</button>`;
      }
    }

    /* ───────── 角色資訊卡 ───────── */

    showActor(kind, id) {
      this.actor = { kind, id };
      this.view.selectedActor = { kind, id };
      this.actorKey = null;
      this.updateActor(true);
    }

    updateActor(force) {
      const el = this.el.actor;
      const a = this.actor;
      if (!a) {
        el.hidden = true;
        this.actorKey = null;
        return;
      }
      const g = this.game;
      if (a.kind === 'staff') {
        const m = g.crewById(a.id);
        if (!m) {
          this.actor = null;
          this.view.selectedActor = null;
          el.hidden = true;
          return;
        }
        const key = 'staff' + a.id;
        if (this.actorKey !== key) {
          this.actorKey = key;
          el.innerHTML = `<span class="x" data-act="actor-close">✕</span><h4><img class="px" src="${avatar(m.rec.look, true, m.boss)}" width="20" height="36" alt=""><span>${esc(m.rec.name)}</span>${m.boss ? '<span class="tag gold">店掌櫃・你</span>' : `<span class="tag gold">Lv.${m.rec.level}</span>`}</h4>
            ${m.boss ? '' : '<div class="bar energy"><i data-f="en"></i></div><div class="bar-label" data-f="entx"></div>'}
            <div class="sub" data-f="st" style="margin:4px 0"></div>
            <div class="sub">速度 ${m.rec.speed.toFixed(2)}　技術 ${m.rec.skill.toFixed(2)}${m.boss ? '　不會累' : ''}</div>
            ${m.boss ? '<button class="btn small" data-act="boss-rename">改名</button>' : `<button class="btn small" data-act="feed" data-id="${m.id}">${ic('bolt', 1)}餵食 ${D.FEED_COST}</button>`}`;
          el.hidden = false;
        }
        if (!m.boss) {
          el.querySelector('[data-f=en]').style.width = m.rec.energy + '%';
          this.setText(el.querySelector('[data-f=entx]'), '體力 ' + Math.round(m.rec.energy));
        }
        this.setText(el.querySelector('[data-f=st]'), '狀態：' + (STATE_SHORT[m.state] || ''));
      } else {
        const c = g.customerById(a.id);
        if (!c) {
          this.actor = null;
          this.view.selectedActor = null;
          el.hidden = true;
          return;
        }
        const key = 'cust' + a.id;
        if (this.actorKey !== key) {
          this.actorKey = key;
          el.innerHTML = `<span class="x" data-act="actor-close">✕</span><h4><img class="px" src="${avatar(c.look, false)}" width="20" height="36" alt=""><span>${c.vip ? esc(c.vipTitle) : '客人'}</span>${c.vip ? '<span class="tag gold">VIP ×3</span>' : ''}</h4>
            <div class="sub" data-f="st"></div><div class="bar"><i data-f="p"></i></div><div class="bar-label">耐心</div>
            <button class="btn small warn" data-act="rush-pay" data-id="${c.id}" data-f="rush" hidden>請掌櫃優先結帳</button>`;
          el.hidden = false;
        }
        const party = g.parties.find((x) => x.id === c.party);
        const st = ({ enter: '走向座位', browse: '看菜單中', wait_order: '等待點餐', ordering: '正在點餐', wait_food: '等待上菜', eat: '用餐中', wait_pay: '吃完了，等結帳', leave: '準備離開' }[c.state] || '') + (party && party.size > 1 ? `　同行 ${party.size} 人` : '');
        const want = c.dish ? `　想吃：${D.dishes[c.dish].name}` : '';
        this.setText(el.querySelector('[data-f=st]'), st + want);
        const rush = el.querySelector('[data-f=rush]');
        if (rush) rush.hidden = !(c.state === 'wait_pay' && !c.rush && c.payBy == null);
        const p = el.querySelector('[data-f=p]');
        p.style.width = Math.max(0, Math.min(1, c.p)) * 100 + '%';
        p.style.background = c.p > 0.55 ? '' : c.p > 0.25 ? '#f2c94c' : '#e8493a';
      }
    }

    /* ───────── 輸入 ───────── */

    bindInput() {
      const canvas = this.view.el;
      document.addEventListener('pointerdown', () => {
        RC.audio.unlock();
      }, { capture: true });
      document.body.addEventListener('click', (e) => {
        // 按完按鈕就放掉焦點，否則空白鍵會被按鈕本身吃掉（變成再按一次同一顆按鈕）
        if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
        const el = e.target.closest('[data-act]');
        if (el && !el.disabled) {
          if (el.classList.contains('off')) return;
          this.act(el.dataset.act, el);
        }
      });
      canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (this.placing) this.cancelPlacing();
      });
      canvas.addEventListener('pointerdown', (e) => this.onDown(e));
      canvas.addEventListener('pointermove', (e) => this.onMove(e));
      canvas.addEventListener('pointerup', (e) => this.onUp(e));
      canvas.addEventListener('pointercancel', () => {
        this.pointer = null;
      });
      canvas.addEventListener('pointerleave', () => {
        if (!this.pointer) this.hover = { x: -99, y: -99 };
        this.updateGhost();
      });
      this.el.pause.addEventListener('click', () => this.togglePause());
      this.el.speed.addEventListener('click', () => {
        this.setSpeed(this.game.speed % 3 + 1);
        RC.audio.sfx('click');
      });
      // 音效、音樂兩顆開關互相獨立
      this.el.sfx.addEventListener('click', () => {
        const A = RC.audio;
        A.setSfx(!A.sfxOn);
        this.persistAudio();
        A.sfx('click'); // 剛打開時給一聲回饋；關掉時這行不會出聲
        this.refreshHud();
        if (this.panel && this.panel.name === 'settings') this.renderPanel();
      });
      this.el.music.addEventListener('click', () => {
        const A = RC.audio;
        A.unlock();
        A.setMusic(!A.musicOn);
        this.persistAudio();
        A.sfx('click');
        this.refreshHud();
        if (this.panel && this.panel.name === 'settings') this.renderPanel();
      });
      // 設定裡的音量滑桿
      document.body.addEventListener('input', (e) => {
        const el = e.target.closest && e.target.closest('[data-vol]');
        if (!el) return;
        const A = RC.audio;
        const v = el.value / 100;
        if (el.dataset.vol === 'sfx') A.setSfxVol(v);
        else A.setMusicVol(v);
        const lab = el.parentElement.querySelector('[data-vol-label]');
        if (lab) lab.textContent = Math.round(v * 100) + '%';
        this.persistAudio();
      });
      document.body.addEventListener('change', (e) => {
        const sel = e.target.closest && e.target.closest('[data-sel]');
        if (sel && this.panel && this.panel.name === 'staff') {
          const g = this.game;
          const v = +sel.value;
          let r;
          if (sel.dataset.sel === 'shift') r = g.setShift(+sel.dataset.id, v);
          else if (sel.dataset.sel === 'open') r = g.setBusinessHours(v, Math.max(g.s.schedule.close, v + 1));
          else r = g.setBusinessHours(g.s.schedule.open, v);
          if (!r.ok) this.toast(r.msg, 'bad');
          RC.audio.sfx(r.ok ? 'click' : 'error');
          this.panel.lastHtml = null;
          this.renderPanel();
        }
        if (e.target.closest && e.target.closest('[data-vol=sfx]')) RC.audio.sfx('coin'); // 放開滑桿時試聽一下
      });
      window.addEventListener('keydown', (e) => this.onKey(e));
      window.addEventListener('resize', () => {
        this.view.resize();
      });
    }

    onKey(e) {
      if (/^(INPUT|TEXTAREA)$/.test((e.target || {}).tagName)) return;
      const k = e.key;
      if (k === 'Escape') {
        if (this.panel) this.closePanel();
        else if (this.placing) this.cancelPlacing();
        else if (this.view.selectedItem != null) this.deselect();
        else if (this.edit) this.setEdit(false);
        else if (this.actor) this.act('actor-close');
      } else if (this.panel) return;
      else if (k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        this.togglePause();
      } else if (k === 'e' || k === 'E') this.setEdit(!this.edit);
      else if (k === 'r' || k === 'R') this.rotateSelected();
      else if ((k === 'Delete' || k === 'Backspace') && this.edit) this.storeSelected();
      else if (k === '1' || k === '2' || k === '3') this.setSpeed(+k);
    }

    pos(e) {
      const r = this.view.el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    onDown(e) {
      if (this.panel) return;
      const p = this.pos(e);
      this.view.el.setPointerCapture && this.view.el.setPointerCapture(e.pointerId);
      this.pointer = { id: e.pointerId, sx: p.x, sy: p.y, moved: false, pick: null };
      const t = this.view.tileAt(p.x, p.y);
      this.hover = t;
      if (this.placing) {
        this.updateGhost();
      } else if (this.edit) {
        const hit = this.view.pick(p.x, p.y);
        if (hit && hit.item) {
          this.select(hit.item.uid);
          this.pointer.pick = hit.item;
        } else this.deselect();
      }
    }

    onMove(e) {
      const p = this.pos(e);
      const t = this.view.tileAt(p.x, p.y);
      this.hover = t;
      const ptr = this.pointer;
      if (ptr && Math.hypot(p.x - ptr.sx, p.y - ptr.sy) > 6) ptr.moved = true;
      if (this.placing) this.updateGhost();
      else if (ptr && ptr.pick && ptr.moved && this.edit) {
        // 拖曳家具
        this.startPlacing(ptr.pick.id, ptr.pick.uid, ptr.pick.rot);
        this.placing.drag = true;
        this.updateGhost();
      } else if (!ptr && !this.edit) {
        const hit = this.view.pick(p.x, p.y);
        this.view.el.classList.toggle('pointer', !!hit);
      }
    }

    onUp(e) {
      const p = this.pos(e);
      const ptr = this.pointer;
      this.pointer = null;
      if (this.panel) return;
      this.hover = this.view.tileAt(p.x, p.y);
      if (this.placing) {
        this.updateGhost();
        const gh = this.view.ghost;
        const pl = this.placing;
        if (!gh) return;
        if (!RC.world.inBounds(this.game.grid, gh.tx, gh.ty)) {
          if (pl.drag || e.pointerType === 'mouse') {
            if (pl.drag) this.cancelPlacing();
          }
          return;
        }
        const g = this.game;
        const r = pl.fromUid ? g.moveItem(pl.fromUid, gh.tx, gh.ty, pl.rot) : g.placeFromInventory(pl.id, gh.tx, gh.ty, pl.rot);
        if (r.ok) {
          RC.audio.sfx('place');
          if (pl.fromUid || !(g.s.inventory[pl.id] > 0)) {
            const keep = pl.fromUid;
            this.cancelPlacing();
            if (keep) this.select(keep);
          } else this.updateGhost();
        } else {
          RC.audio.sfx('error');
          this.toast(r.msg, 'bad');
          if (pl.drag) {
            const keep = pl.fromUid;
            this.cancelPlacing();
            this.select(keep);
          }
        }
        return;
      }
      if (this.edit) return;
      if (ptr && ptr.moved) return;
      const hit = this.view.pick(p.x, p.y);
      if (hit && (hit.type === 'staff' || hit.type === 'customer')) {
        if (hit.type === 'customer') {
          const c = this.game.customerById(hit.id);
          if (c && c.state === 'wait_pay') this.game.rushPay(c.id); // 點頭上有金幣的客人：請掌櫃優先去結帳
        }
        RC.audio.sfx('click');
        this.showActor(hit.type, hit.id);
      } else if (this.actor) {
        this.actor = null;
        this.view.selectedActor = null;
        this.updateActor(true);
      }
    }

    /* ───────── 每幀 ───────── */

    update(dt) {
      const s = this.game.s;
      // 金幣數字滾動
      if (this.coinShown !== s.coins) {
        const d = s.coins - this.coinShown;
        this.coinShown += Math.abs(d) < 2 ? d : d * Math.min(1, dt * 10);
        if (Math.abs(s.coins - this.coinShown) < 1) this.coinShown = s.coins;
      }
      this.setText(this.el.coins, fmt(Math.round(this.coinShown)));
      this.panelTimer += dt;
      if (this.dirty) {
        this.dirty = false;
        this.refreshHud();
        if (this.panel && this.panel.name !== 'modal' && this.panel.name !== 'levelup') this.renderPanel();
        this.patchStaffPanel();
      }
      if (this.panelTimer > 0.4) {
        this.panelTimer = 0;
        this.patchStaffPanel();
      }
      this.actorTimer += dt;
      if (this.actorTimer > 0.2) {
        this.actorTimer = 0;
        this.updateActor();
      }
      this.warnTimer += dt;
      if (this.warnTimer > 0.5) {
        this.warnTimer = 0;
        this.updateClock(); // 時鐘不靠事件觸發，固定時間刷新
        this.updateWarn();
        this.refreshBadges();
        // 經驗條等緩慢變化的數值
        this.refreshHudLite();
      }
      this.updateItemTool();
    }

    refreshHudLite() {
      const s = this.game.s;
      const need = D.xpForLevel(s.level);
      this.el.xpbar.style.width = (s.level >= D.MAX_LEVEL ? 100 : Math.min(100, (s.xp / need) * 100)) + '%';
      this.setText(this.el.xplabel, s.level >= D.MAX_LEVEL ? '已達最高等級' : `經驗 ${s.xp} / ${need}`);
      this.refreshQuest();
    }
  }

  RC.UI = UI;
})(typeof globalThis !== 'undefined' ? globalThis : window);
