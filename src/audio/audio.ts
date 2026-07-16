// Web Audio によるBGM・効果音のリアルタイム合成（外部音源ファイル不使用）
// BGM はコロブチカ（Korobeiniki、パブリックドメイン）のチップチューン風アレンジ。

import { ClearInfo, Game } from '../core/tetris';

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// [MIDIノート(0=休符), 長さ(8分音符単位)]
const MELODY: [number, number][] = [
  [76, 2], [71, 1], [72, 1], [74, 2], [72, 1], [71, 1],
  [69, 2], [69, 1], [72, 1], [76, 2], [74, 1], [72, 1],
  [71, 2], [71, 1], [72, 1], [74, 2], [76, 2],
  [72, 2], [69, 2], [69, 2], [0, 2],
  [74, 3], [77, 1], [81, 2], [79, 1], [77, 1],
  [76, 3], [72, 1], [76, 2], [74, 1], [72, 1],
  [71, 2], [71, 1], [72, 1], [74, 2], [76, 2],
  [72, 2], [69, 2], [69, 2], [0, 2],
];

const BASS_ROOTS = [45, 45, 40, 45, 50, 48, 40, 45];
const BASS: [number, number][] = [];
for (const r of BASS_ROOTS) {
  BASS.push([r, 2], [r + 7, 2], [r, 2], [r + 7, 2]);
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private sfxGain!: GainNode;
  private delaySend!: GainNode;
  private noiseBuf!: AudioBuffer;

  muted = false;
  volume = 0.6;

  private seqTimer: number | null = null;
  private eighth = 0.19;
  private nextM = 0;
  private iM = 0;
  private nextB = 0;
  private iB = 0;
  private nextH = 0;
  private iH = 0;
  private lastMoveSfx = 0;

  resume(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;

    // マスター → コンプレッサー（音圧・まとまり）→ 出力
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(comp);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0.5;
    this.musicGain.connect(this.master);
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.master);

    // 空間系：フィードバックディレイ（音楽に奥行きを与える）
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.26;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    const wet = ctx.createGain();
    wet.gain.value = 0.16;
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(this.musicGain);
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 1;
    this.delaySend.connect(delay);

    const len = Math.floor(ctx.sampleRate * 0.3);
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setMuted(v: boolean): void {
    this.muted = v;
    if (this.ctx) this.master.gain.value = v ? 0 : this.volume;
  }

  setVolume(v: number): void {
    this.volume = Math.min(Math.max(v, 0), 1);
    if (this.ctx && !this.muted) this.master.gain.value = this.volume;
  }

  // ---- BGM ----

  startMusic(level: number): void {
    if (!this.ctx) return;
    this.stopMusic();
    this.setLevel(level);
    const t = this.ctx.currentTime + 0.08;
    this.nextM = t;
    this.nextB = t;
    this.nextH = t;
    this.iM = 0;
    this.iB = 0;
    this.iH = 0;
    this.seqTimer = window.setInterval(() => this.schedule(), 30);
  }

  stopMusic(): void {
    if (this.seqTimer !== null) {
      clearInterval(this.seqTimer);
      this.seqTimer = null;
    }
  }

  setLevel(level: number): void {
    const speed = Math.min(1 + (level - 1) * 0.03, 1.5);
    this.eighth = 0.19 / speed;
  }

  private schedule(): void {
    const ctx = this.ctx!;
    const horizon = ctx.currentTime + 0.15;
    while (this.nextM < horizon) {
      const [note, dur] = MELODY[this.iM];
      if (note > 0) this.lead(midiHz(note), dur * this.eighth * 0.92, this.nextM);
      this.nextM += dur * this.eighth;
      this.iM = (this.iM + 1) % MELODY.length;
    }
    while (this.nextB < horizon) {
      const [note, dur] = BASS[this.iB];
      this.bass(midiHz(note), dur * this.eighth * 0.9, this.nextB);
      this.nextB += dur * this.eighth;
      this.iB = (this.iB + 1) % BASS.length;
    }
    // ドラム＆コードは8分音符グリッドで駆動（1小節=8分×8）
    while (this.nextH < horizon) {
      const pos = this.iH % 8;
      this.hat(this.nextH, pos % 4 === 0);
      if (pos % 4 === 0) this.kick(this.nextH);
      if (pos % 4 === 2) this.snare(this.nextH);
      if (pos === 0) {
        const bar = Math.floor(this.iH / 8) % BASS_ROOTS.length;
        this.chordStab(BASS_ROOTS[bar], this.nextH);
      }
      this.nextH += this.eighth;
      this.iH++;
    }
  }

  // リード：デチューンした2枚のノコギリ波＋オクターブ下のサブで分厚く
  private lead(freq: number, dur: number, at: number): void {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.085, at + 0.012);
    g.gain.setValueAtTime(0.085, at + Math.max(dur - 0.05, 0.02));
    g.gain.linearRampToValueAtTime(0, at + dur);
    lp.connect(g);
    g.connect(this.musicGain);
    g.connect(this.delaySend);

    const mk = (f: number, type: OscillatorType, gain: number) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = gain;
      osc.connect(og).connect(lp);
      osc.start(at);
      osc.stop(at + dur + 0.02);
    };
    mk(freq * 1.004, 'sawtooth', 1);
    mk(freq * 0.996, 'sawtooth', 1);
    mk(freq / 2, 'square', 0.35);
  }

  // ベース：矩形波＋三角波の2層でパンチを出す
  private bass(freq: number, dur: number, at: number): void {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.24, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    lp.connect(g).connect(this.musicGain);
    for (const [type, mul, vol] of [
      ['square', 1, 0.7],
      ['triangle', 1, 1],
      ['sine', 0.5, 0.8],
    ] as [OscillatorType, number, number][]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq * mul;
      const og = ctx.createGain();
      og.gain.value = vol;
      osc.connect(og).connect(lp);
      osc.start(at);
      osc.stop(at + dur + 0.02);
    }
  }

  // コード刺し：小節頭に薄いパッドで和音を鳴らして重厚感を出す
  private chordStab(rootMidi: number, at: number): void {
    const ctx = this.ctx!;
    const isMajor = rootMidi === 40; // Eの小節だけメジャー
    const chord = [rootMidi + 12, rootMidi + (isMajor ? 16 : 15), rootMidi + 19];
    const dur = this.eighth * 7;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.035, at + 0.05);
    g.gain.setValueAtTime(0.035, at + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, at + dur);
    lp.connect(g);
    g.connect(this.musicGain);
    g.connect(this.delaySend);
    for (const m of chord) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = midiHz(m);
      osc.connect(lp);
      osc.start(at);
      osc.stop(at + dur + 0.05);
    }
  }

  private kick(at: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(42, at + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.14);
    osc.connect(g).connect(this.musicGain);
    osc.start(at);
    osc.stop(at + 0.16);
  }

  private snare(at: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.1);
    src.connect(bp).connect(g).connect(this.musicGain);
    src.start(at);
    src.stop(at + 0.12);
    const tone = ctx.createOscillator();
    tone.type = 'triangle';
    tone.frequency.value = 190;
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.1, at);
    tg.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
    tone.connect(tg).connect(this.musicGain);
    tone.start(at);
    tone.stop(at + 0.08);
  }

  private hat(at: number, accent: boolean): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(accent ? 0.045 : 0.02, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.035);
    src.connect(hp).connect(g).connect(this.musicGain);
    src.start(at);
    src.stop(at + 0.05);
  }

  // ---- SFX ----

  private blip(
    freq: number,
    dur: number,
    gain: number,
    type: OscillatorType = 'square',
    slideTo?: number,
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const at = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    osc.connect(g).connect(this.sfxGain);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private noiseHit(dur: number, gain: number, freq = 1200): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const at = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(bp).connect(g).connect(this.sfxGain);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  private arp(notes: number[], step: number, dur: number, gain: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    notes.forEach((n, i) => {
      const at = ctx.currentTime + i * step;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = midiHz(n);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, at);
      g.gain.exponentialRampToValueAtTime(0.001, at + dur);
      osc.connect(g).connect(this.sfxGain);
      osc.start(at);
      osc.stop(at + dur + 0.02);
    });
  }

  move(): void {
    const now = performance.now();
    if (now - this.lastMoveSfx < 35) return;
    this.lastMoveSfx = now;
    this.blip(520, 0.035, 0.05);
  }

  rotate(): void {
    this.blip(430, 0.06, 0.07, 'square', 660);
  }

  lock(): void {
    this.blip(120, 0.07, 0.12, 'triangle');
    this.noiseHit(0.04, 0.06, 800);
  }

  hardDrop(): void {
    this.blip(240, 0.1, 0.12, 'sawtooth', 70);
    this.noiseHit(0.09, 0.14, 500);
  }

  hold(): void {
    this.arp([72, 79], 0.05, 0.08, 0.08);
  }

  clear(info: ClearInfo): void {
    if (info.pc) {
      this.arp([72, 76, 79, 84, 88, 91, 96], 0.07, 0.3, 0.1);
      return;
    }
    if (info.tspin) {
      // ド派手：重低音ドロップ＋ワブル＋上昇アルペジオ
      this.blip(160, 0.4, 0.28, 'sine', 38);
      this.noiseHit(0.3, 0.2, 300);
      this.blip(300, 0.26, 0.14, 'sawtooth', 720);
      this.arp([74, 78, 81, 86, 90, 93].slice(0, 3 + info.lines), 0.055, 0.22, 0.11);
      return;
    }
    switch (info.lines) {
      case 1:
        this.arp([72, 76], 0.05, 0.12, 0.08);
        break;
      case 2:
        this.arp([72, 76, 79], 0.05, 0.13, 0.08);
        break;
      case 3:
        this.arp([72, 76, 79, 84], 0.05, 0.14, 0.09);
        break;
      case 4:
        this.arp([64, 69, 72, 76, 81, 88], 0.055, 0.24, 0.11);
        break;
    }
    if (info.combo >= 2) {
      this.blip(midiHz(76 + Math.min(info.combo, 12)), 0.09, 0.07);
    }
  }

  levelUp(): void {
    this.arp([60, 64, 67, 72, 76, 79, 84], 0.05, 0.16, 0.09);
  }

  gameOver(): void {
    this.stopMusic();
    this.arp([64, 62, 60, 57, 55, 52, 48, 45], 0.14, 0.3, 0.1);
  }

  attack(power: number): void {
    this.blip(500, 0.14, 0.12, 'sawtooth', 900 + power * 120);
    this.noiseHit(0.08, 0.08, 2500);
  }

  garbageRise(rows: number): void {
    this.blip(90, 0.22, 0.2, 'triangle', 55);
    this.noiseHit(0.18, 0.14, 350);
    if (rows >= 4) this.blip(70, 0.3, 0.16, 'sawtooth', 45);
  }

  win(): void {
    this.stopMusic();
    this.arp([60, 64, 67, 72, 76, 79, 84, 88], 0.07, 0.28, 0.11);
  }

  // ゲームイベントとの接続
  bind(game: Game): void {
    game.on('move', () => this.move());
    game.on('rotate', () => this.rotate());
    game.on('lock', () => this.lock());
    game.on('harddrop', (p) => {
      const dist = (p as { dist: number }).dist;
      if (dist > 0) this.hardDrop();
    });
    game.on('hold', () => this.hold());
    game.on('clear', (info) => this.clear(info as ClearInfo));
    game.on('garbage', (rows) => this.garbageRise(rows as number));
    game.on('levelup', (lv) => {
      this.levelUp();
      this.setLevel(lv as number);
    });
    game.on('gameover', () => this.gameOver());
  }
}
