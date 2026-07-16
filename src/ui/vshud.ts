// 対戦モード用HUD：左右プレイヤーパネル・戦略表示・気持ちバブル・勝敗表示

import { Game, PieceType } from '../core/tetris';
import { StrategyId } from '../ai/ai';
import { pickFeeling } from './feelings';
import { drawMino } from './preview';

const STRATEGY_LABEL: Record<StrategyId | 'human', string> = {
  tspin: '🧠 Tスピン狙い',
  combo: '🧠 連コンボ狙い',
  tetris: '🧠 テトリス棒狙い',
  human: '🎮 あなた',
};

interface PlayerPanel {
  rootEl: HTMLElement;
  scoreEl: HTMLElement;
  linesEl: HTMLElement;
  sentEl: HTMLElement;
  strategyEl: HTMLElement;
  feelingEl: HTMLElement;
  feelingText: HTMLElement;
  holdCtx: CanvasRenderingContext2D;
  nextCtx: CanvasRenderingContext2D;
  sent: number;
  feelingTimer: number | null;
  lastFeelAt: number;
}

export class VsHud {
  private wrap: HTMLElement;
  private panels: PlayerPanel[] = [];
  private overlayEl: HTMLElement | null = null;

  constructor(
    private root: HTMLElement,
    private games: [Game, Game],
    private names: [string, string],
  ) {
    this.wrap = document.createElement('div');
    this.wrap.id = 'vshud';
    this.wrap.style.display = 'none';
    root.appendChild(this.wrap);

    for (let i = 0; i < 2; i++) {
      this.buildPanel(i);
      const g = games[i];
      g.on('score', () => this.refresh(i));
      g.on('spawn', () => this.drawPreviews(i));
      g.on('hold', () => this.drawPreviews(i));
      g.on('reset', () => {
        this.panels[i].sent = 0;
        this.refresh(i);
        this.drawPreviews(i);
      });
    }
  }

  private buildPanel(i: number): void {
    const el = document.createElement('div');
    el.className = `vs-panel vs-p${i + 1}`;
    el.innerHTML = `
      <div class="vs-name">${this.names[i]}</div>
      <div class="vs-strategy">—</div>
      <div class="vs-row"><span>SCORE</span><b class="v-score">0</b></div>
      <div class="vs-row"><span>LINES</span><b class="v-lines">0</b></div>
      <div class="vs-row"><span>ATK</span><b class="v-sent">0</b></div>
      <div class="vs-minis">
        <div><div class="vs-mini-label">HOLD</div><canvas class="v-hold" width="72" height="48"></canvas></div>
        <div><div class="vs-mini-label">NEXT</div><canvas class="v-next" width="72" height="150"></canvas></div>
      </div>
      <div class="vs-feeling"><span class="vs-feeling-text"></span></div>
    `;
    this.wrap.appendChild(el);
    this.panels.push({
      rootEl: el,
      scoreEl: el.querySelector('.v-score')!,
      linesEl: el.querySelector('.v-lines')!,
      sentEl: el.querySelector('.v-sent')!,
      strategyEl: el.querySelector('.vs-strategy')!,
      feelingEl: el.querySelector('.vs-feeling')!,
      feelingText: el.querySelector('.vs-feeling-text')!,
      holdCtx: (el.querySelector('.v-hold') as HTMLCanvasElement).getContext('2d')!,
      nextCtx: (el.querySelector('.v-next') as HTMLCanvasElement).getContext('2d')!,
      sent: 0,
      feelingTimer: null,
      lastFeelAt: 0,
    });
  }

  setNames(names: [string, string]): void {
    this.names = names;
    this.panels.forEach((p, i) => {
      p.rootEl.querySelector('.vs-name')!.textContent = names[i];
    });
  }

  show(): void {
    this.wrap.style.display = '';
  }

  hide(): void {
    this.wrap.style.display = 'none';
    this.hideOverlay();
  }

  setStrategy(i: number, id: StrategyId | 'human'): void {
    this.panels[i].strategyEl.textContent = STRATEGY_LABEL[id];
  }

  addSent(i: number, n: number): void {
    this.panels[i].sent += n;
    this.panels[i].sentEl.textContent = String(this.panels[i].sent);
  }

  private refresh(i: number): void {
    const g = this.games[i];
    const p = this.panels[i];
    p.scoreEl.textContent = g.score.toLocaleString();
    p.linesEl.textContent = String(g.lines);
  }

  private drawPreviews(i: number): void {
    const g = this.games[i];
    const p = this.panels[i];
    p.holdCtx.clearRect(0, 0, 72, 48);
    if (g.holdType) {
      p.holdCtx.globalAlpha = g.canHold ? 1 : 0.35;
      drawMino(p.holdCtx, g.holdType, 36, 24, 10);
      p.holdCtx.globalAlpha = 1;
    }
    p.nextCtx.clearRect(0, 0, 72, 150);
    const types: PieceType[] = g.nextTypes(3);
    types.forEach((t, k) => {
      p.nextCtx.globalAlpha = 1 - k * 0.22;
      drawMino(p.nextCtx, t, 36, 26 + k * 50, 9);
    });
    p.nextCtx.globalAlpha = 1;
  }

  feel(i: number, category: string, n?: number): void {
    const p = this.panels[i];
    const priority =
      category.startsWith('clear.') ||
      category.startsWith('strategy.') ||
      category.startsWith('attack.') ||
      category === 'danger' ||
      category === 'gameover';
    const now = performance.now();
    if (!priority && now - p.lastFeelAt < 2600) return;
    const line = pickFeeling(category, n);
    if (!line) return;
    p.lastFeelAt = now;
    p.feelingText.textContent = line;
    p.feelingEl.classList.remove('show');
    void p.feelingEl.offsetWidth;
    p.feelingEl.classList.add('show');
    if (p.feelingTimer !== null) clearTimeout(p.feelingTimer);
    p.feelingTimer = window.setTimeout(() => p.feelingEl.classList.remove('show'), 4600);
  }

  showWinner(winner: number, auto: boolean, onRestart: () => void): void {
    this.hideOverlay();
    const g = this.games[winner];
    const el = document.createElement('div');
    el.className = 'overlay';
    el.innerHTML = `
      <h1 class="logo small">${this.names[winner]} WINS!</h1>
      <div class="result">
        <div><span>SCORE</span><b>${g.score.toLocaleString()}</b></div>
        <div><span>LINES</span><b>${g.lines}</b></div>
        <div><span>ATK</span><b>${this.panels[winner].sent}</b></div>
        <div><span>TETRIS</span><b>${g.stats.tetris}</b></div>
        <div><span>T-SPIN</span><b>${g.stats.tspins}</b></div>
        <div><span>MAX COMBO</span><b>${Math.max(g.stats.maxCombo, 0)}</b></div>
      </div>
      <button class="menu-btn" id="vs-restart">↻ 再戦</button>
      <div class="help" id="vs-restart-note">${auto ? '5秒後に次の試合が始まります…' : 'ENTER で再戦'}</div>
    `;
    el.querySelector('#vs-restart')!.addEventListener('click', onRestart);
    this.root.appendChild(el);
    this.overlayEl = el;
  }

  updateRestartCountdown(sec: number): void {
    const note = this.overlayEl?.querySelector('#vs-restart-note');
    if (note) note.textContent = `${sec}秒後に次の試合が始まります…`;
  }

  hideOverlay(): void {
    if (this.overlayEl) {
      this.overlayEl.remove();
      this.overlayEl = null;
    }
  }
}
