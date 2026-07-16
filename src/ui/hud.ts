// HUD：スコアパネル・ネクスト/ホールド表示・アクションテキスト・
// タイトル/ポーズ/ゲームオーバー画面

import { ClearInfo, Game } from '../core/tetris';
import { StrategyId } from '../ai/ai';
import { pickFeeling } from './feelings';
import { drawMino } from './preview';

export type TitleChoice = 'auto' | 'manual' | 'vs-cpu' | 'vs-human';

const STRATEGY_META: Record<StrategyId | 'manual', { en: string; ja: string; color: string }> = {
  tspin: { en: 'T-SPIN HUNT', ja: 'Tスピン狙い', color: '#d38bff' },
  combo: { en: 'REN COMBO', ja: '連コンボ狙い', color: '#ffd75c' },
  tetris: { en: 'TETRIS RUSH', ja: 'テトリス棒狙い', color: '#5cf2ff' },
  manual: { en: 'MANUAL', ja: '手動操作中', color: '#8fa5d8' },
};

export class HUD {
  private scoreEl!: HTMLElement;
  private levelEl!: HTMLElement;
  private linesEl!: HTMLElement;
  private timeEl!: HTMLElement;
  private holdCtx!: CanvasRenderingContext2D;
  private nextCtx!: CanvasRenderingContext2D;
  private actionLayer!: HTMLElement;
  private overlayEl: HTMLElement | null = null;
  private badge!: HTMLElement;
  autoBtn!: HTMLButtonElement;
  soundBtn!: HTMLButtonElement;
  volSlider!: HTMLInputElement;
  private strategyEn!: HTMLElement;
  private strategyJa!: HTMLElement;
  private strategyBanner!: HTMLElement;
  private feelingEl!: HTMLElement;
  private feelingText!: HTMLElement;
  private feelingTimer: number | null = null;
  private lastFeelAt = 0;

  private lastTimeText = '';

  constructor(
    private root: HTMLElement,
    private game: Game,
  ) {
    this.build();
    this.bind();
  }

  private build(): void {
    const wrap = document.createElement('div');
    wrap.id = 'hud';
    wrap.innerHTML = `
      <div class="panel" id="panel-left">
        <div class="panel-title">HOLD</div>
        <canvas id="hold-cv" width="96" height="64"></canvas>
        <div class="stat"><div class="label">SCORE</div><div class="value" id="st-score">0</div></div>
        <div class="stat"><div class="label">LEVEL</div><div class="value" id="st-level">1</div></div>
        <div class="stat"><div class="label">LINES</div><div class="value" id="st-lines">0</div></div>
        <div class="stat"><div class="label">TIME</div><div class="value small" id="st-time">0:00</div></div>
      </div>
      <div class="panel" id="panel-right">
        <div class="panel-title">NEXT</div>
        <canvas id="next-cv" width="96" height="330"></canvas>
      </div>
      <div id="badge-auto" class="on">AUTO PLAY</div>
      <div id="top-buttons">
        <button id="btn-auto" class="mini-btn">🤖 AUTO: ON</button>
        <button id="btn-sound" class="mini-btn">♪ ON</button>
        <span id="vol-wrap">🔊<input id="vol" type="range" min="0" max="100" value="60"></span>
      </div>
      <div id="strategy-banner">
        <span class="sb-icon">🧠</span>
        <div>
          <div id="sb-en">—</div>
          <div id="sb-ja">—</div>
        </div>
      </div>
      <div id="feeling"><span id="feeling-text"></span></div>
      <div id="action-layer"></div>
    `;
    this.root.appendChild(wrap);

    this.scoreEl = wrap.querySelector('#st-score')!;
    this.levelEl = wrap.querySelector('#st-level')!;
    this.linesEl = wrap.querySelector('#st-lines')!;
    this.timeEl = wrap.querySelector('#st-time')!;
    this.holdCtx = (wrap.querySelector('#hold-cv') as HTMLCanvasElement).getContext('2d')!;
    this.nextCtx = (wrap.querySelector('#next-cv') as HTMLCanvasElement).getContext('2d')!;
    this.actionLayer = wrap.querySelector('#action-layer')!;
    this.badge = wrap.querySelector('#badge-auto')!;
    this.autoBtn = wrap.querySelector('#btn-auto')!;
    this.soundBtn = wrap.querySelector('#btn-sound')!;
    this.volSlider = wrap.querySelector('#vol')!;
    this.strategyBanner = wrap.querySelector('#strategy-banner')!;
    this.strategyEn = wrap.querySelector('#sb-en')!;
    this.strategyJa = wrap.querySelector('#sb-ja')!;
    this.feelingEl = wrap.querySelector('#feeling')!;
    this.feelingText = wrap.querySelector('#feeling-text')!;
  }

  setStrategy(id: StrategyId | 'manual'): void {
    const meta = STRATEGY_META[id];
    this.strategyEn.textContent = meta.en;
    this.strategyJa.textContent = `戦略：${meta.ja}`;
    this.strategyBanner.style.borderColor = meta.color;
    this.strategyBanner.style.color = meta.color;
    this.strategyBanner.style.boxShadow = `0 0 16px ${meta.color}44`;
  }

  announceStrategy(id: StrategyId): void {
    const meta = STRATEGY_META[id];
    const el = document.createElement('div');
    el.className = 'action-text t-strategy mega';
    el.style.color = meta.color;
    el.textContent = meta.en;
    this.actionLayer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    this.spawnText(`〜 ${meta.ja} 〜`, 't-combo');
  }

  // 「プレイヤーの気持ち」表示。priority=true のカテゴリは連投制限を無視
  feel(category: string, n?: number): void {
    const priority =
      category.startsWith('clear.') ||
      category.startsWith('strategy.') ||
      category === 'danger' ||
      category === 'gameover';
    const now = performance.now();
    if (!priority && now - this.lastFeelAt < 2600) return;
    const line = pickFeeling(category, n);
    if (!line) return;
    this.lastFeelAt = now;
    this.feelingText.textContent = line;
    this.feelingEl.classList.remove('show');
    void this.feelingEl.offsetWidth; // アニメーション再トリガ
    this.feelingEl.classList.add('show');
    if (this.feelingTimer !== null) clearTimeout(this.feelingTimer);
    this.feelingTimer = window.setTimeout(() => {
      this.feelingEl.classList.remove('show');
    }, 5200);
  }

  private bind(): void {
    const g = this.game;
    g.on('score', () => this.refreshStats());
    g.on('spawn', () => this.drawNext());
    g.on('hold', () => {
      this.drawHold();
      this.drawNext();
    });
    g.on('reset', () => {
      this.refreshStats();
      this.drawHold();
      this.drawNext();
    });
    g.on('clear', (payload) => this.showClear(payload as ClearInfo));
    g.on('levelup', (lv) => this.spawnText(`LEVEL ${lv}`, 't-level'));
  }

  refreshStats(): void {
    this.scoreEl.textContent = this.game.score.toLocaleString();
    this.levelEl.textContent = String(this.game.level);
    this.linesEl.textContent = String(this.game.lines);
  }

  tick(): void {
    const t = Math.floor(this.game.stats.time);
    const text = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    if (text !== this.lastTimeText) {
      this.lastTimeText = text;
      this.timeEl.textContent = text;
    }
  }

  drawHold(): void {
    const ctx = this.holdCtx;
    ctx.clearRect(0, 0, 96, 64);
    if (this.game.holdType) {
      ctx.globalAlpha = this.game.canHold ? 1 : 0.35;
      drawMino(ctx, this.game.holdType, 48, 32, 13);
      ctx.globalAlpha = 1;
    }
  }

  drawNext(): void {
    const ctx = this.nextCtx;
    ctx.clearRect(0, 0, 96, 330);
    const types = this.game.nextTypes(5);
    types.forEach((t, i) => {
      ctx.globalAlpha = i === 0 ? 1 : 0.85 - i * 0.12;
      drawMino(ctx, t, 48, 36 + i * 64, i === 0 ? 14 : 12);
    });
    ctx.globalAlpha = 1;
  }

  // ソロ用UI（サイドパネル・バッジ・戦略バナー・気持ちバブル）の表示切替
  setSoloVisible(v: boolean): void {
    const d = v ? '' : 'none';
    (document.getElementById('panel-left') as HTMLElement).style.display = d;
    (document.getElementById('panel-right') as HTMLElement).style.display = d;
    this.badge.style.display = d;
    this.strategyBanner.style.display = v ? '' : 'none';
    this.feelingEl.style.display = d;
  }

  private showClear(info: ClearInfo): void {
    if (info.pc) {
      this.spawnText('PERFECT CLEAR', 't-pc mega');
      this.flashScreen('rgba(255, 246, 174, 0.5)');
    }
    let name = '';
    let cls = 't-normal';
    if (info.tspin) {
      name =
        'T-SPIN' +
        (info.mini ? ' MINI' : '') +
        (['', ' SINGLE', ' DOUBLE', ' TRIPLE'][info.lines] || '');
      cls = info.lines >= 2 ? 't-tspin mega' : 't-tspin';
      this.flashScreen('rgba(211, 139, 255, 0.45)');
    } else if (info.lines > 0) {
      name = ['', 'SINGLE', 'DOUBLE', 'TRIPLE', 'TETRIS'][info.lines];
      if (info.lines === 4) {
        cls = 't-tetris mega';
        this.flashScreen('rgba(92, 242, 255, 0.4)');
      }
    }
    if (info.b2b) name = 'B2B ' + name;
    if (name) this.spawnText(name, cls);
    if (info.combo >= 1) this.spawnText(`${info.combo} COMBO`, 't-combo');
    if (info.points > 0) this.spawnText(`+${info.points.toLocaleString()}`, 't-points');
  }

  flashScreen(color: string): void {
    const el = document.createElement('div');
    el.className = 'screen-flash';
    el.style.background = `radial-gradient(circle at 50% 45%, ${color} 0%, transparent 72%)`;
    this.root.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  spawnText(text: string, cls: string): void {
    const el = document.createElement('div');
    el.className = `action-text ${cls}`;
    el.textContent = text;
    this.actionLayer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  setAutoBadge(on: boolean): void {
    this.badge.textContent = on ? 'AUTO PLAY' : 'MANUAL';
    this.badge.className = on ? 'on' : 'off';
    this.autoBtn.textContent = on ? '🤖 AUTO: ON' : '🤖 AUTO: OFF';
  }

  setSound(on: boolean): void {
    this.soundBtn.textContent = on ? '♪ ON' : '♪ OFF';
  }

  // ---- オーバーレイ ----

  private overlay(html: string): HTMLElement {
    this.hideOverlay();
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = html;
    this.root.appendChild(el);
    this.overlayEl = el;
    return el;
  }

  hideOverlay(): void {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
  }

  showTitle(onSelect: (choice: TitleChoice) => void): void {
    const el = this.overlay(`
      <h1 class="logo">NEON TETRIS</h1>
      <div class="subtitle">オートプレイ観賞型 3D テトリス</div>
      <div class="menu-grid">
        <button class="menu-btn" id="m-auto">▶ オートプレイ観賞</button>
        <button class="menu-btn" id="m-manual">🎮 自分でプレイ</button>
        <button class="menu-btn" id="m-vs-cpu">⚔ CPU対戦を観戦</button>
        <button class="menu-btn" id="m-vs-human">🥊 CPUと対戦</button>
      </div>
      <div class="help">
        ←→ 移動　↓ ソフトドロップ　SPACE ハードドロップ<br>
        ↑ / X 右回転　Z 左回転　C / SHIFT ホールド<br>
        A オート切替　M サウンド　ENTER スタート／ポーズ　🎮 ゲームパッド対応
      </div>
    `);
    el.querySelector('#m-auto')!.addEventListener('click', () => onSelect('auto'));
    el.querySelector('#m-manual')!.addEventListener('click', () => onSelect('manual'));
    el.querySelector('#m-vs-cpu')!.addEventListener('click', () => onSelect('vs-cpu'));
    el.querySelector('#m-vs-human')!.addEventListener('click', () => onSelect('vs-human'));
  }

  showCountdown(done: () => void): void {
    const el = this.overlay(`<div class="countdown">READY</div>`);
    const cd = el.querySelector('.countdown') as HTMLElement;
    setTimeout(() => {
      cd.textContent = 'GO!';
      cd.classList.add('go');
    }, 700);
    setTimeout(() => {
      this.hideOverlay();
      done();
    }, 1200);
  }

  showPause(): void {
    this.overlay(`
      <div class="countdown">PAUSE</div>
      <div class="help">ENTER で再開</div>
    `);
  }

  showGameOver(auto: boolean, onRestart: () => void): HTMLElement {
    const g = this.game;
    const t = Math.floor(g.stats.time);
    const el = this.overlay(`
      <h1 class="logo small">GAME OVER</h1>
      <div class="result">
        <div><span>SCORE</span><b>${g.score.toLocaleString()}</b></div>
        <div><span>LINES</span><b>${g.lines}</b></div>
        <div><span>LEVEL</span><b>${g.level}</b></div>
        <div><span>TETRIS</span><b>${g.stats.tetris}</b></div>
        <div><span>T-SPIN</span><b>${g.stats.tspins}</b></div>
        <div><span>MAX COMBO</span><b>${Math.max(g.stats.maxCombo, 0)}</b></div>
        <div><span>TIME</span><b>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</b></div>
      </div>
      <button class="menu-btn" id="m-restart">↻ リスタート</button>
      <div class="help" id="auto-restart-note">${auto ? 'オートプレイを5秒後に再開します…' : 'ENTER でリスタート'}</div>
    `);
    el.querySelector('#m-restart')!.addEventListener('click', onRestart);
    return el;
  }

  updateRestartCountdown(sec: number): void {
    const note = this.overlayEl?.querySelector('#auto-restart-note');
    if (note) note.textContent = `オートプレイを${sec}秒後に再開します…`;
  }
}
