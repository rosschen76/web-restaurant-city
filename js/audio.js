/* 音效：全部用 WebAudio 即時合成（不需要音檔）。含簡單的 8-bit 背景音樂。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});

  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // 合成出來的原始波形振幅很小，各條匯流排乘上基準增益後再交給限幅器，避免太小聲或爆音
  const SFX_BASE = 4.5;
  const MUSIC_BASE = 2;

  /* ── 背景音樂：自創的 bossa nova（全部即時合成，沒有取樣、沒有版權問題）──
   * 118 BPM、16 分音符為一格，每小節 16 格；8 小節和弦循環，旋律共 16 小節（兩遍，第二遍較高、較活潑）。
   * 編制：貝斯（根音＋五音的切分走法）、吉他（bossa 經典切分 clave）、邊鼓（cross-stick）、軟底鼓、沙鈴、類顫音琴旋律。 */
  const BPM = 118;
  const BAR = 16;
  const FORM_BARS = 8;
  const MUSIC_BARS = 16;
  // b = 貝斯根音、g = 吉他和弦（MIDI 音高，由低到高）
  const CHORD = {
    Cmaj9: { b: 48, g: [55, 59, 62, 64] },
    A7b13: { b: 45, g: [55, 61, 65, 69] },
    Dm9: { b: 50, g: [53, 57, 60, 64] },
    G13: { b: 43, g: [53, 59, 64, 69] },
    Em9: { b: 52, g: [55, 59, 62, 66] },
    A7: { b: 45, g: [55, 61, 64, 71] },
    G7b9: { b: 43, g: [53, 59, 62, 68] },
    Am9: { b: 45, g: [55, 60, 64, 71] },
  };
  // 每小節一個或兩個和弦（兩個時各佔半小節）
  const FORM = [['Cmaj9'], ['A7b13'], ['Dm9'], ['G13'], ['Em9', 'A7'], ['Dm9', 'G7b9'], ['Cmaj9', 'Am9'], ['Dm9', 'G7b9']];
  // 旋律：[小節, 第幾格, MIDI, 長度（格）]
  const MELODY = [
    // 第一遍：舒緩、留白
    [0, 0, 76, 6], [0, 6, 74, 2], [0, 8, 72, 4], [0, 12, 74, 4],
    [1, 0, 73, 6], [1, 6, 76, 2], [1, 8, 77, 4], [1, 12, 76, 4],
    [2, 0, 77, 6], [2, 6, 76, 2], [2, 8, 74, 8],
    [3, 0, 71, 4], [3, 4, 74, 2], [3, 6, 77, 2], [3, 8, 76, 4], [3, 12, 74, 4],
    [4, 0, 79, 6], [4, 6, 76, 2], [4, 8, 73, 4], [4, 12, 76, 4],
    [5, 0, 77, 6], [5, 6, 74, 2], [5, 8, 71, 4], [5, 12, 68, 4],
    [6, 0, 72, 8], [6, 8, 76, 4], [6, 12, 79, 4],
    [7, 0, 77, 6], [7, 6, 74, 2], [7, 8, 71, 8],
    // 第二遍：往上一些、多一點動作
    [8, 0, 79, 6], [8, 6, 76, 2], [8, 8, 79, 4], [8, 12, 83, 4],
    [9, 0, 81, 6], [9, 6, 77, 2], [9, 8, 76, 4], [9, 12, 73, 4],
    [10, 0, 74, 4], [10, 4, 77, 2], [10, 6, 81, 2], [10, 8, 79, 4], [10, 12, 77, 4],
    [11, 0, 76, 6], [11, 6, 74, 2], [11, 8, 71, 4], [11, 12, 74, 4],
    [12, 0, 76, 4], [12, 4, 79, 4], [12, 8, 81, 4], [12, 12, 73, 4],
    [13, 0, 77, 6], [13, 6, 76, 2], [13, 8, 74, 4], [13, 12, 71, 4],
    [14, 0, 76, 8], [14, 8, 72, 4], [14, 12, 69, 4],
    [15, 0, 74, 6], [15, 6, 77, 2], [15, 8, 74, 4], [15, 12, 71, 4],
  ];
  const MELODY_AT = new Map(MELODY.map(([bar, st, n, len]) => [bar * BAR + st, { n, len }]));
  // 吉他的 bossa clave：兩小節一輪（第一小節 1、2 拍後半、4 拍；第二小節 2、3 拍）
  const CLAVE = new Set([0, 6, 12, 20, 24]);
  // 邊鼓（cross-stick）敲在同一組節奏上
  const chordAt = (i) => {
    const arr = FORM[((i / BAR) | 0) % FORM_BARS];
    return CHORD[arr.length > 1 && i % BAR >= 8 ? arr[1] : arr[0]];
  };

  const audio = {
    ctx: null,
    // 音效與音樂是兩個完全獨立的開關與音量
    sfxOn: true,
    musicOn: true,
    sfxVol: 0.8,
    musicVol: 0.7,
    master: null,
    sfxBus: null,
    musicBus: null,
    noiseBuf: null,
    playing: false,
    step: 0,
    nextT: 0,
    timer: null,

    /** 必須在使用者操作（點擊/觸控）後呼叫，瀏覽器才允許出聲。 */
    unlock() {
      if (!this.ctx) {
        const AC = G.AudioContext || G.webkitAudioContext;
        if (!AC) return false;
        try {
          this.ctx = new AC();
        } catch (e) {
          return false;
        }
        // 音效匯流排、音樂匯流排 → 主音量 → 限幅器 → 喇叭
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -12;
        comp.knee.value = 12;
        comp.ratio.value = 8;
        comp.attack.value = 0.003;
        comp.release.value = 0.15;
        comp.connect(this.ctx.destination);
        this.master = this.ctx.createGain();
        this.master.gain.value = 1;
        this.master.connect(comp);
        this.sfxBus = this.ctx.createGain();
        this.sfxBus.connect(this.master);
        this.musicBus = this.ctx.createGain();
        this.musicBus.connect(this.master);
        this.applyVolumes();
        const n = this.ctx.sampleRate * 0.2;
        this.noiseBuf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.syncMusic();
      return true;
    },

    tone(freq, t0, dur, type, vol, slideTo, dest) {
      const c = this.ctx;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(dest || this.sfxBus);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    },

    noise(t0, dur, vol, dest) {
      const c = this.ctx;
      const s = c.createBufferSource();
      s.buffer = this.noiseBuf;
      const g = c.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      const f = c.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 6000;
      s.connect(f);
      f.connect(g);
      g.connect(dest || this.sfxBus);
      s.start(t0);
      s.stop(t0 + dur + 0.02);
    },

    sfx(name) {
      if (!this.sfxOn || !this.ctx || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime;
      switch (name) {
        case 'coin':
          this.tone(988, t, 0.09, 'square', 0.07);
          this.tone(1319, t + 0.07, 0.18, 'square', 0.07);
          break;
        case 'ping':
          this.tone(1568, t, 0.12, 'triangle', 0.05);
          break;
        case 'ding':
          this.tone(880, t, 0.25, 'sine', 0.08);
          this.tone(1760, t, 0.18, 'sine', 0.03);
          break;
        case 'click':
          this.tone(520, t, 0.05, 'square', 0.04);
          break;
        case 'place':
          this.tone(220, t, 0.07, 'square', 0.07, 110);
          this.tone(330, t + 0.05, 0.08, 'square', 0.05);
          break;
        case 'buy':
          this.tone(660, t, 0.07, 'square', 0.06);
          this.tone(880, t + 0.06, 0.07, 'square', 0.06);
          this.tone(1320, t + 0.12, 0.14, 'square', 0.06);
          break;
        case 'error':
          this.tone(180, t, 0.14, 'sawtooth', 0.06, 110);
          break;
        case 'angry':
          this.tone(300, t, 0.2, 'sawtooth', 0.05, 120);
          break;
        case 'levelup':
          [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, t + i * 0.09, 0.2, 'square', 0.07));
          break;
        case 'quest':
          [784, 988, 1175].forEach((f, i) => this.tone(f, t + i * 0.08, 0.16, 'triangle', 0.09));
          break;
        default:
      }
    },

    /* ── 背景音樂（bossa nova，見上方 CHORD / MELODY） ── */
    /** 把開關與音量套用到匯流排（關掉時直接把該匯流排靜音，連殘響也一起停） */
    applyVolumes() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.sfxBus.gain.setTargetAtTime(this.sfxOn ? this.sfxVol * SFX_BASE : 0, t, 0.02);
      this.musicBus.gain.setTargetAtTime(this.musicOn ? this.musicVol * MUSIC_BASE : 0, t, 0.05);
    },
    setSfx(on) {
      this.sfxOn = !!on;
      this.applyVolumes();
    },
    setMusic(on) {
      this.musicOn = !!on;
      this.applyVolumes();
      this.syncMusic();
    },
    setSfxVol(v) {
      this.sfxVol = Math.max(0, Math.min(1, +v || 0));
      this.applyVolumes();
    },
    setMusicVol(v) {
      this.musicVol = Math.max(0, Math.min(1, +v || 0));
      this.applyVolumes();
    },
    syncMusic() {
      if (!this.ctx) return;
      if (this.musicOn && !this.playing) {
        this.playing = true;
        this.step = 0;
        this.nextT = this.ctx.currentTime + 0.1;
        this.schedule();
      } else if (!this.musicOn && this.playing) {
        this.playing = false;
        clearTimeout(this.timer);
      }
    },
    schedule() {
      if (!this.playing) return;
      const c = this.ctx;
      const stepDur = 60 / BPM / 4;
      while (this.nextT < c.currentTime + 0.35) {
        this.playStep(this.step, this.nextT, stepDur);
        this.nextT += stepDur;
        this.step = (this.step + 1) % (MUSIC_BARS * BAR);
      }
      this.timer = setTimeout(() => this.schedule(), 100);
    },
    playStep(i, t, d) {
      const out = this.musicBus;
      const k = i % BAR; // 小節內第幾格
      const ch = chordAt(i);
      // 貝斯：1 拍根音、2 拍後半五音、3 拍根音、4 拍後半五音（bossa 的切分走法）
      if (k === 0 || k === 8) this.bass(ch.b, t, d * 5, 0.15, out);
      else if (k === 6 || k === 14) this.bass(ch.b + 7, t, d * 2.5, 0.11, out);
      // 軟底鼓：只在 1、3 拍輕輕墊底
      if (k === 0 || k === 8) this.tone(80, t, 0.14, 'sine', k === 0 ? 0.13 : 0.09, 45, out);
      // 吉他切分（輕微掃弦，短促）與邊鼓
      if (CLAVE.has(i % 32)) {
        ch.g.forEach((n, j) => this.tone(midi(n), t + j * 0.006, d * 3.2, 'triangle', 0.032, null, out));
        this.tone(midi(ch.g[0] - 12), t, d * 2, 'sine', 0.03, null, out);
        this.tone(1700, t, 0.035, 'triangle', 0.05, 900, out);
      }
      // 沙鈴：十六分音符不間斷，八分音符正拍較重
      this.noise(t, 0.035, k % 2 === 0 ? 0.034 : 0.016, out);
      // 旋律（顫音琴般的柔和音色）
      const m = MELODY_AT.get(i % (MUSIC_BARS * BAR));
      if (m) {
        const f = midi(m.n);
        const len = Math.min(d * m.len * 1.25, 1.1);
        this.tone(f, t, len, 'sine', 0.06, null, out);
        this.tone(f * 2, t, len * 0.5, 'sine', 0.014, null, out);
        this.tone(f * 4, t, 0.08, 'sine', 0.004, null, out);
      }
    },
    bass(n, t, dur, vol, out) {
      this.tone(midi(n), t, dur, 'triangle', vol, null, out);
      this.tone(midi(n + 12), t, dur * 0.7, 'sine', vol * 0.3, null, out); // 小喇叭也聽得到的泛音
    },
  };

  RC.audio = audio;
})(typeof globalThis !== 'undefined' ? globalThis : window);
