/* 音效：全部用 WebAudio 即時合成（不需要音檔）。含簡單的 8-bit 背景音樂。 */
(function (G) {
  'use strict';
  const RC = (G.RC = G.RC || {});

  const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

  const audio = {
    ctx: null,
    sfxOn: true,
    musicOn: true,
    master: null,
    musicGain: null,
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
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(this.ctx.destination);
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.5;
        this.musicGain.connect(this.master);
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
      g.connect(dest || this.master);
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
      g.connect(dest || this.master);
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

    /* ── 背景音樂：C – Am – F – G 的輕快循環 ── */
    setSfx(on) {
      this.sfxOn = !!on;
    },
    setMusic(on) {
      this.musicOn = !!on;
      this.syncMusic();
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
      const stepDur = 60 / 112 / 2;
      while (this.nextT < c.currentTime + 0.35) {
        this.playStep(this.step, this.nextT, stepDur);
        this.nextT += stepDur;
        this.step = (this.step + 1) % 32;
      }
      this.timer = setTimeout(() => this.schedule(), 100);
    },
    playStep(i, t, d) {
      const bar = (i / 8) | 0;
      const k = i % 8;
      const root = [48, 45, 41, 43][bar];
      const arp = [
        [0, 4, 7, 12, 7, 4, 7, 4],
        [0, 3, 7, 12, 7, 3, 7, 3],
        [0, 4, 7, 12, 7, 4, 7, 4],
        [0, 4, 7, 11, 7, 4, 7, 4],
      ][bar];
      const mel = [
        [76, null, 79, null, 76, 74, 72, null],
        [76, null, 81, null, 76, 72, 69, null],
        [77, null, 81, null, 77, 76, 72, null],
        [79, null, 83, null, 79, 77, 74, null],
      ][bar];
      const out = this.musicGain;
      if (k === 0 || k === 4) this.tone(midi(root - 12), t, d * 1.8, 'triangle', 0.16, null, out);
      if (k === 2 || k === 6) this.tone(midi(root - 5), t, d * 0.9, 'triangle', 0.09, null, out);
      this.tone(midi(root + 12 + arp[k]), t, d * 0.8, 'square', 0.018, null, out);
      if (mel[k]) this.tone(midi(mel[k]), t, d * 1.6, 'square', 0.04, null, out);
      if (k % 2 === 1) this.noise(t, 0.03, 0.03, out);
    },
  };

  RC.audio = audio;
})(typeof globalThis !== 'undefined' ? globalThis : window);
