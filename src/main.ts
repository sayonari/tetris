// エントリポイント：全モジュールの結線とメインループ

import './style.css';
import { ClearInfo, Game } from './core/tetris';
import { AutoPlayer } from './ai/ai';
import { AudioEngine } from './audio/audio';
import { Btn, BtnEvent, GamepadPoller, InputBus, Keyboard } from './input/input';
import { Renderer3D } from './render/renderer';
import { Controller } from './ui/controller';
import { HUD } from './ui/hud';

type AppState = 'title' | 'countdown' | 'playing' | 'paused' | 'over';

const GAME_BTNS = new Set<Btn>(['left', 'right', 'down', 'up', 'a', 'b', 'hold']);

const DAS = 0.17;
const ARR = 0.04;

const root = document.getElementById('app')!;

const game = new Game();
const bus = new InputBus();
const renderer = new Renderer3D(root, game);
const hud = new HUD(root, game);
new Controller(root, bus);
new Keyboard(bus);
const pads = new GamepadPoller();
const audio = new AudioEngine();
audio.bind(game);
const ai = new AutoPlayer(game, bus);

let state: AppState = 'title';
let autoplay = true;
let restartTimer = 0;
let hitStop = 0; // 大技演出時に一瞬時を止める

// 人間の押しっぱなし状態（DAS/ARR用）
const held = { left: false, right: false };
let dasDir = 0;
let dasTimer = 0;
let arrAcc = 0;

function setAutoplay(v: boolean): void {
  autoplay = v;
  ai.setEnabled(v);
  hud.setAutoBadge(v);
  if (!v) {
    hud.setStrategy('manual');
    hud.feel('manual');
  }
}

// AIの戦略・気持ちをHUDへ
ai.onStrategyChange = (s) => {
  hud.setStrategy(s);
  if (state === 'playing') {
    hud.announceStrategy(s);
    hud.feel(`strategy.${s}`);
  }
};
ai.onFeeling = (cat, n) => {
  if (autoplay) hud.feel(cat, n);
};

// 音量スライダー（localStorageに保存）
const savedVol = Number(localStorage.getItem('tetris-volume') ?? '60');
hud.volSlider.value = String(savedVol);
audio.setVolume(savedVol / 100);
hud.volSlider.addEventListener('input', () => {
  const v = Number(hud.volSlider.value);
  audio.resume();
  audio.setVolume(v / 100);
  localStorage.setItem('tetris-volume', String(v));
});

function begin(auto: boolean): void {
  hud.hideOverlay();
  game.reset();
  state = 'countdown';
  held.left = held.right = false;
  dasDir = 0;
  setAutoplay(auto);
  hud.showCountdown(() => {
    state = 'playing';
    game.playing = true;
    audio.startMusic(game.level);
    if (auto) {
      ai.setEnabled(true);
      hud.feel('start');
    }
  });
}

function togglePause(): void {
  if (state === 'playing') {
    state = 'paused';
    game.playing = false;
    audio.stopMusic();
    hud.showPause();
  } else if (state === 'paused') {
    state = 'playing';
    game.playing = true;
    audio.startMusic(game.level);
    hud.hideOverlay();
  }
}

game.on('clear', (p) => {
  const info = p as ClearInfo;
  if (info.tspin || info.lines === 4 || info.pc) hitStop = 0.2;
  if (autoplay) {
    if (info.pc) hud.feel('clear.pc');
    else if (info.tspin && info.lines >= 3) hud.feel('clear.tst');
    else if (info.tspin && info.lines === 2) hud.feel('clear.tsd');
    else if (info.tspin && info.lines === 1) hud.feel('clear.tss');
    else if (info.lines === 4) hud.feel('clear.tetris');
    else if (info.combo >= 3) hud.feel('combo.chain', info.combo);
    else if (info.b2b) hud.feel('clear.b2b');
  }
});

game.on('levelup', () => {
  if (autoplay) hud.feel('levelup');
});

game.on('gameover', () => {
  state = 'over';
  restartTimer = 5;
  if (autoplay) hud.feel('gameover');
  hud.showGameOver(autoplay, () => {
    audio.resume();
    begin(autoplay);
  });
});

function handleInput(e: BtnEvent): void {
  // オートプレイ中に人間がゲーム操作をしたらマニュアルへ
  if (
    e.source === 'human' &&
    e.pressed &&
    autoplay &&
    state === 'playing' &&
    GAME_BTNS.has(e.btn)
  ) {
    setAutoplay(false);
    hud.spawnText('MANUAL MODE', 't-combo');
  }

  if (e.btn === 'start') {
    if (!e.pressed) return;
    audio.resume();
    if (state === 'title') begin(true);
    else if (state === 'playing' || state === 'paused') togglePause();
    else if (state === 'over') begin(autoplay);
    return;
  }

  if (state !== 'playing') return;

  if (e.pressed) {
    switch (e.btn) {
      case 'left':
        if (e.source === 'human') {
          held.left = true;
          dasDir = -1;
          dasTimer = 0;
          arrAcc = 0;
        }
        game.moveLeft();
        break;
      case 'right':
        if (e.source === 'human') {
          held.right = true;
          dasDir = 1;
          dasTimer = 0;
          arrAcc = 0;
        }
        game.moveRight();
        break;
      case 'down':
        if (e.source === 'ai') game.nudgeDown();
        else game.setSoftDrop(true);
        break;
      case 'up':
        game.hardDrop();
        break;
      case 'a':
        game.rotate(1);
        break;
      case 'b':
        game.rotate(-1);
        break;
      case 'hold':
        game.hold();
        break;
    }
  } else {
    switch (e.btn) {
      case 'left':
        if (e.source === 'human') {
          held.left = false;
          if (dasDir === -1) dasDir = held.right ? 1 : 0;
          dasTimer = 0;
        }
        break;
      case 'right':
        if (e.source === 'human') {
          held.right = false;
          if (dasDir === 1) dasDir = held.left ? -1 : 0;
          dasTimer = 0;
        }
        break;
      case 'down':
        if (e.source === 'human') game.setSoftDrop(false);
        break;
    }
  }
}

bus.on(handleInput);

// バスに流さない補助キー
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyA' && !e.repeat) {
    if (state === 'playing') {
      setAutoplay(!autoplay);
      hud.spawnText(autoplay ? 'AUTO MODE' : 'MANUAL MODE', 't-combo');
    }
  } else if (e.code === 'KeyM' && !e.repeat) {
    audio.resume();
    audio.setMuted(!audio.muted);
    hud.setSound(!audio.muted);
  } else if (e.code === 'Escape' && !e.repeat) {
    if (state === 'playing' || state === 'paused') togglePause();
  }
});

hud.autoBtn.addEventListener('click', () => {
  if (state === 'playing') {
    setAutoplay(!autoplay);
  }
});

hud.soundBtn.addEventListener('click', () => {
  audio.resume();
  audio.setMuted(!audio.muted);
  hud.setSound(!audio.muted);
});

function updateDAS(dt: number): void {
  if (dasDir === 0 || (!held.left && !held.right)) return;
  dasTimer += dt;
  if (dasTimer < DAS) return;
  arrAcc += dt;
  while (arrAcc >= ARR) {
    arrAcc -= ARR;
    if (dasDir === -1) game.moveLeft();
    else game.moveRight();
  }
}

hud.showTitle((auto) => {
  audio.resume();
  begin(auto);
});

let last = performance.now();

function loop(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  pads.poll(bus);

  if (state === 'playing') {
    if (hitStop > 0) {
      hitStop -= dt;
    } else {
      updateDAS(dt);
      game.step(dt);
      ai.step(dt);
    }
  } else if (state === 'over' && autoplay) {
    const before = Math.ceil(restartTimer);
    restartTimer -= dt;
    const after = Math.ceil(restartTimer);
    if (after !== before && after >= 0) hud.updateRestartCountdown(after);
    if (restartTimer <= 0) {
      begin(true);
    }
  } else {
    ai.step(dt);
  }

  renderer.render(dt);
  hud.tick();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
