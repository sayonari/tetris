// エントリポイント：全モジュールの結線とメインループ
// モード：solo（オートプレイ観賞／手動）・vs（CPU対戦観戦／CPUと対戦）

import './style.css';
import { ClearInfo, Game } from './core/tetris';
import { AutoPlayer } from './ai/ai';
import { AudioEngine } from './audio/audio';
import { Btn, BtnEvent, GamepadPoller, InputBus, Keyboard } from './input/input';
import { Renderer3D } from './render/renderer';
import { Battle } from './battle/battle';
import { Controller } from './ui/controller';
import { HUD, TitleChoice } from './ui/hud';
import { VsHud } from './ui/vshud';

type AppState = 'title' | 'countdown' | 'playing' | 'paused' | 'over';
type Mode = 'solo' | 'vs';

const GAME_BTNS = new Set<Btn>(['left', 'right', 'down', 'up', 'a', 'b', 'hold']);

const DAS = 0.17;
const ARR = 0.04;

const root = document.getElementById('app')!;

const game = new Game(); // P1（ソロ・対戦共通）
const game2 = new Game(); // P2（対戦のみ）
const bus = new InputBus();
const bus2 = new InputBus();
const renderer = new Renderer3D(root);
renderer.setBoards([game]);
const hud = new HUD(root, game);
const vshud = new VsHud(root, [game, game2], ['CPU-1', 'CPU-2']);
const controller1 = new Controller(root, bus, 'pad-solo');
const controller2 = new Controller(root, bus2, 'pad-p2');
controller2.setVisible(false);
new Keyboard(bus);
const pads = new GamepadPoller();
const audio = new AudioEngine();
audio.bind(game);
audio.bind(game2);
const ai = new AutoPlayer(game, bus);
const ai2 = new AutoPlayer(game2, bus2);

let state: AppState = 'title';
let mode: Mode = 'solo';
let vsHuman = false;
let autoplay = true;
let restartTimer = 0;
let hitStop = 0;
let battle: Battle | null = null;
let boardsMode: Mode = 'solo';

// 人間の押しっぱなし状態（DAS/ARR用、P1のみ）
const held = { left: false, right: false };
let dasDir = 0;
let dasTimer = 0;
let arrAcc = 0;

function p1Name(): string {
  return mode === 'vs' ? (vsHuman ? 'YOU' : 'CPU-1') : 'P1';
}

function setAutoplay(v: boolean): void {
  autoplay = v;
  ai.setEnabled(v);
  hud.setAutoBadge(v);
  if (mode === 'solo') {
    if (!v) {
      hud.setStrategy('manual');
      hud.feel('manual');
    }
  } else {
    vshud.setStrategy(0, v ? ai.strategy : 'human');
  }
}

// AIの戦略・気持ちをHUDへ
ai.onStrategyChange = (s) => {
  if (mode === 'solo') {
    hud.setStrategy(s);
    if (state === 'playing') {
      hud.announceStrategy(s);
      hud.feel(`strategy.${s}`);
    }
  } else {
    vshud.setStrategy(0, s);
    if (state === 'playing') vshud.feel(0, `strategy.${s}`);
  }
};
ai2.onStrategyChange = (s) => {
  vshud.setStrategy(1, s);
  if (state === 'playing' && mode === 'vs') vshud.feel(1, `strategy.${s}`);
};
ai.onFeeling = (cat, n) => {
  if (!autoplay) return;
  if (mode === 'solo') hud.feel(cat, n);
  else vshud.feel(0, cat, n);
};
ai2.onFeeling = (cat, n) => {
  if (mode === 'vs') vshud.feel(1, cat, n);
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

function feelClear(player: 0 | 1, info: ClearInfo): void {
  const feel = (cat: string, n?: number) => {
    if (mode === 'solo') {
      if (player === 0 && autoplay) hud.feel(cat, n);
    } else {
      if (player === 0 && !autoplay) return; // 人間操作中はP1のつぶやきなし
      vshud.feel(player, cat, n);
    }
  };
  if (info.pc) feel('clear.pc');
  else if (info.tspin && info.lines >= 3) feel('clear.tst');
  else if (info.tspin && info.lines === 2) feel('clear.tsd');
  else if (info.tspin && info.lines === 1) feel('clear.tss');
  else if (info.lines === 4) feel('clear.tetris');
  else if (info.combo >= 3) feel('combo.chain', info.combo);
  else if (info.b2b) feel('clear.b2b');
}

game.on('clear', (p) => {
  const info = p as ClearInfo;
  if (info.tspin || info.lines === 4 || info.pc) hitStop = 0.2;
  feelClear(0, info);
});

game2.on('clear', (p) => {
  const info = p as ClearInfo;
  if (info.tspin || info.lines === 4 || info.pc) hitStop = 0.2;
  feelClear(1, info);
});

game.on('levelup', () => {
  if (autoplay && mode === 'solo') hud.feel('levelup');
});

// ソロのゲームオーバー
game.on('gameover', () => {
  if (mode !== 'solo') return;
  state = 'over';
  restartTimer = 5;
  if (autoplay) hud.feel('gameover');
  hud.showGameOver(autoplay, () => {
    audio.resume();
    beginSolo(autoplay);
  });
});

function ensureBoards(m: Mode): void {
  if (boardsMode === m) return;
  boardsMode = m;
  renderer.setBoards(m === 'vs' ? [game, game2] : [game]);
}

function beginSolo(auto: boolean): void {
  mode = 'solo';
  ensureBoards('solo');
  hud.setSoloVisible(true);
  vshud.hide();
  controller1.setPositionClass('pad-solo');
  controller1.setVisible(true);
  controller2.setVisible(false);
  hud.hideOverlay();
  game.reset();
  game2.playing = false;
  ai2.setEnabled(false);
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

function beginVs(human: boolean): void {
  mode = 'vs';
  vsHuman = human;
  ensureBoards('vs');
  hud.setSoloVisible(false);
  hud.hideOverlay();
  vshud.setNames([human ? 'YOU' : 'CPU-1', 'CPU-2']);
  vshud.show();
  vshud.hideOverlay();
  controller1.setPositionClass('pad-p1');
  controller1.setVisible(true);
  controller2.setVisible(true);
  game.reset();
  game2.reset();
  held.left = held.right = false;
  dasDir = 0;

  battle = new Battle([game, game2]);
  battle.onAttack = (e) => {
    vshud.addSent(e.from, e.raw);
    if (e.power > 0) {
      audio.attack(e.power);
      vshud.feel(e.from as 0 | 1, 'attack.send', e.power);
      vshud.feel(e.to as 0 | 1, 'attack.recv', e.power);
      const names = [vsHuman ? 'YOU' : 'CPU-1', 'CPU-2'];
      hud.spawnText(`${names[e.from]} ⚔ ${e.power} LINES`, 't-combo');
    }
  };
  battle.onWinner = (w) => {
    state = 'over';
    restartTimer = 6;
    audio.win();
    vshud.feel(w as 0 | 1, 'battle.win');
    vshud.feel((1 - w) as 0 | 1, 'battle.lose');
    vshud.showWinner(w, !vsHuman, () => {
      audio.resume();
      beginVs(vsHuman);
    });
  };

  state = 'countdown';
  setAutoplay(!human);
  hud.showCountdown(() => {
    state = 'playing';
    game.playing = true;
    game2.playing = true;
    audio.startMusic(1);
    ai2.setEnabled(true);
    if (!human) ai.setEnabled(true);
    vshud.feel(0, 'battle.start');
    vshud.feel(1, 'battle.start');
  });
}

function togglePause(): void {
  if (state === 'playing') {
    state = 'paused';
    game.playing = false;
    game2.playing = false;
    audio.stopMusic();
    hud.showPause();
  } else if (state === 'paused') {
    state = 'playing';
    game.playing = true;
    if (mode === 'vs') game2.playing = true;
    audio.startMusic(game.level);
    hud.hideOverlay();
  }
}

function restartCurrent(): void {
  if (mode === 'solo') beginSolo(autoplay);
  else beginVs(vsHuman);
}

function handleInput(e: BtnEvent): void {
  // オートプレイ中に人間がゲーム操作をしたらP1をマニュアルへ
  if (
    e.source === 'human' &&
    e.pressed &&
    autoplay &&
    state === 'playing' &&
    GAME_BTNS.has(e.btn)
  ) {
    setAutoplay(false);
    if (mode === 'solo') hud.spawnText('MANUAL MODE', 't-combo');
  }

  if (e.btn === 'start') {
    if (!e.pressed) return;
    audio.resume();
    if (state === 'title') beginSolo(true);
    else if (state === 'playing' || state === 'paused') togglePause();
    else if (state === 'over') restartCurrent();
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

// P2バスはAI専用：ゲーム操作をgame2へ
bus2.on((e) => {
  if (state !== 'playing' || e.source !== 'ai') return;
  if (!e.pressed) return;
  switch (e.btn) {
    case 'left':
      game2.moveLeft();
      break;
    case 'right':
      game2.moveRight();
      break;
    case 'down':
      game2.nudgeDown();
      break;
    case 'up':
      game2.hardDrop();
      break;
    case 'a':
      game2.rotate(1);
      break;
    case 'b':
      game2.rotate(-1);
      break;
    case 'hold':
      game2.hold();
      break;
  }
});

// バスに流さない補助キー
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyA' && !e.repeat) {
    if (state === 'playing') {
      setAutoplay(!autoplay);
      if (mode === 'solo') {
        hud.spawnText(autoplay ? 'AUTO MODE' : 'MANUAL MODE', 't-combo');
      }
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

hud.showTitle((choice: TitleChoice) => {
  audio.resume();
  if (choice === 'auto') beginSolo(true);
  else if (choice === 'manual') beginSolo(false);
  else if (choice === 'vs-cpu') beginVs(false);
  else beginVs(true);
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
      if (mode === 'vs') {
        game2.step(dt);
        ai2.step(dt);
      }
    }
  } else if (state === 'over') {
    const auto = mode === 'solo' ? autoplay : !vsHuman;
    if (auto) {
      const before = Math.ceil(restartTimer);
      restartTimer -= dt;
      const after = Math.ceil(restartTimer);
      if (after !== before && after >= 0) {
        if (mode === 'solo') hud.updateRestartCountdown(after);
        else vshud.updateRestartCountdown(after);
      }
      if (restartTimer <= 0) restartCurrent();
    }
    ai.step(dt);
    ai2.step(dt);
  } else {
    ai.step(dt);
    ai2.step(dt);
  }

  renderer.render(dt);
  hud.tick();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
