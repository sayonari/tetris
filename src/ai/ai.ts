// オートプレイAI（戦略切替型）
// - Dellacherie評価関数をベースに、戦略ごとのボーナス/ペナルティで行動を変化させる
//   * tspin : T-spinスロットを構築・温存し、TSD/TSTをスピン入れで決める
//   * combo : 左3列を温存して右を高く積み、一気に連鎖（コンボ）で消す
//   * tetris: 右端1列を温存して9列を平らに積み、I棒で4列消し
// - 盤面が危険な高さになったら自動で survival（立て直し）に退避
// - 操作は InputBus 経由の仮想ボタンなので、画面上のコントローラも連動して光る

import {
  ActivePiece,
  COLS,
  Game,
  PieceType,
  ROWS,
  attemptRotation,
  collides,
  pieceCells,
  spawnPiece,
} from '../core/tetris';
import { Btn, InputBus } from '../input/input';

export type StrategyId = 'tspin' | 'combo' | 'tetris';
export type EvalStrategy = StrategyId | 'survival';
export type ComboPhase = 'build' | 'clear';

export interface StrategyState {
  strategy: EvalStrategy;
  phase: ComboPhase;
}

type PathAction = 'left' | 'right' | 'cw' | 'ccw' | 'down';
type PlanAction = PathAction | 'drop' | 'hold';

const W = {
  landing: -4.500158825,
  eroded: 3.4181268,
  rowT: -3.2178882,
  colT: -9.348695,
  holes: -7.899265,
  wells: -3.3855972,
};

const COMBO_WELL = 3; // 左3列を温存
const TETRIS_WELL = COLS - 1; // 右端1列を温存

export function boardMaxHeight(g: number[][], fromCol = 0, toCol = COLS - 1): number {
  let h = 0;
  for (let c = fromCol; c <= toCol; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (g[r][c] !== 0) {
        h = Math.max(h, ROWS - r);
        break;
      }
    }
  }
  return h;
}

// 右端1列以外が全部埋まった「テトリス準備完了」行の数
function readyRowsTetris(g: number[][]): number {
  let n = 0;
  for (let r = 0; r < ROWS; r++) {
    if (g[r][TETRIS_WELL] !== 0) continue;
    let full = true;
    for (let c = 0; c < TETRIS_WELL; c++) {
      if (g[r][c] === 0) {
        full = false;
        break;
      }
    }
    if (full) n++;
  }
  return n;
}

// Tミノ用：バウンディングボックス四隅の埋まり状態（盤外は埋まり扱い）
function tCorners(grid: number[][], bx: number, by: number): boolean[] {
  const corners: [number, number][] = [
    [bx, by],
    [bx + 2, by],
    [bx, by + 2],
    [bx + 2, by + 2],
  ];
  return corners.map(
    ([cx, cy]) => cx < 0 || cx >= COLS || cy >= ROWS || (cy >= 0 && grid[cy][cx] !== 0),
  );
}

function countTCorners(grid: number[][], bx: number, by: number): number {
  return tCorners(grid, bx, by).filter(Boolean).length;
}

// セル群を置いたと仮定した時に揃う行数
function linesIfPlaced(g: number[][], cells: [number, number][]): number {
  let n = 0;
  const rows = [...new Set(cells.map((c) => c[1]))];
  for (const r of rows) {
    if (r < 0 || r >= ROWS) continue;
    let full = true;
    for (let c = 0; c < COLS; c++) {
      if (g[r][c] === 0 && !cells.some(([cx, cy]) => cx === c && cy === r)) {
        full = false;
        break;
      }
    }
    if (full) n++;
  }
  return n;
}

// T出現位置から「スピン入れ（最後が回転）でTSD以上」が実際に可能か検証するBFS。
// 幾何判定だけでは「スピンで入れないニセスロット」を拾ってしまうため、これが真実。
export function spinTSDReachable(grid: number[][]): boolean {
  const start = spawnPiece('T');
  if (collides(grid, 'T', start.rot, start.x, start.y)) return false;
  const nodes: { x: number; y: number; rot: number }[] = [
    { x: start.x, y: start.y, rot: start.rot },
  ];
  const seen = new Set<number>([stateKey(start.x, start.y, start.rot)]);
  for (let i = 0; i < nodes.length && nodes.length < 1500; i++) {
    const n = nodes[i];
    const push = (x: number, y: number, rot: number, viaSpin: boolean): boolean => {
      const k = stateKey(x, y, rot);
      if (seen.has(k)) return false;
      seen.add(k);
      nodes.push({ x, y, rot });
      if (viaSpin && collides(grid, 'T', rot, x, y + 1) && countTCorners(grid, x, y) >= 3) {
        if (linesIfPlaced(grid, pieceCells('T', rot, x, y)) >= 2) return true;
      }
      return false;
    };
    for (const dir of [1, -1] as const) {
      const r = attemptRotation(grid, { type: 'T', rot: n.rot, x: n.x, y: n.y }, dir);
      if (r && push(r.x, r.y, r.rot, true)) return true;
    }
    for (const dx of [-1, 1]) {
      if (!collides(grid, 'T', n.rot, n.x + dx, n.y)) push(n.x + dx, n.y, n.rot, false);
    }
    if (!collides(grid, 'T', n.rot, n.x, n.y + 1)) push(n.x, n.y + 1, n.rot, false);
  }
  return false;
}

// 盤面のT-spinスロット評価（構築・維持ボーナス用）。
// 「あと数セルで完成する」近似スロットに段階的に加点して構築の勾配を作り、
// 完成形はBFSで実際にスピン入れ可能なものだけ高評価する。
export function tSlotBonus(g: number[][]): number {
  let best = 0;
  let geomFull = false;
  for (const rot of [1, 2, 3]) {
    for (let x = -1; x < COLS - 1; x++) {
      for (let y = 0; y < ROWS - 2; y++) {
        if (collides(g, 'T', rot, x, y)) continue;
        if (!collides(g, 'T', rot, x, y + 1)) continue; // 接地位置のみ
        const corners = tCorners(g, x, y);
        const nCorners = corners.filter(Boolean).length;
        const bothBottom = corners[2] && corners[3];
        if (nCorners < 2 || !bothBottom) continue;
        const cells = pieceCells('T', rot, x, y);
        const rows = [...new Set(cells.map((c) => c[1]))].filter((r) => r >= 0 && r < ROWS);
        let fullRows = 0;
        let missing = 0;
        for (const r of rows) {
          let empty = 0;
          for (let c = 0; c < COLS; c++) {
            if (g[r][c] === 0 && !cells.some(([cx, cy]) => cx === c && cy === r)) empty++;
          }
          if (empty === 0) fullRows++;
          else missing += empty;
        }
        if (nCorners >= 3) {
          if (fullRows >= 2) geomFull = true;
          else if (fullRows === 1 && missing <= 3) best = Math.max(best, 40 - 7 * missing);
          else if (missing <= 4) best = Math.max(best, 18 - 3 * missing);
        } else {
          // 底2コーナー＋ノッチ形状のみ（あとは屋根を乗せればスロット完成）
          if (fullRows === 2) best = Math.max(best, 38);
          else if (fullRows === 1 && missing <= 2) best = Math.max(best, 22 - 5 * missing);
        }
      }
    }
  }
  if (geomFull && spinTSDReachable(g)) return 60;
  return best;
}

function evaluatePlacement(
  grid: number[][],
  type: PieceType,
  rot: number,
  x: number,
  y: number,
  spinFinal: boolean,
  st: StrategyState,
): number {
  const g = grid.map((row) => row.slice());
  const cells = pieceCells(type, rot, x, y);
  for (const [cx, cy] of cells) {
    if (cy >= 0) g[cy][cx] = 1;
  }

  const fullRows: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    if (g[r].every((c) => c !== 0)) fullRows.push(r);
  }
  const cleared = fullRows.length;
  const pieceCellsInCleared = cells.filter(([, cy]) => fullRows.includes(cy)).length;
  const eroded = cleared * pieceCellsInCleared;
  for (const r of fullRows) {
    g.splice(r, 1);
    g.unshift(Array(COLS).fill(0));
  }

  const ys = cells.map(([, cy]) => cy);
  const landing = (ROWS - 1 - Math.max(...ys) + (ROWS - 1 - Math.min(...ys))) / 2;

  let rowT = 0;
  for (let r = 0; r < ROWS; r++) {
    let prev = 1;
    for (let c = 0; c < COLS; c++) {
      const cur = g[r][c] !== 0 ? 1 : 0;
      if (cur !== prev) rowT++;
      prev = cur;
    }
    if (prev === 0) rowT++;
  }

  let colT = 0;
  let holes = 0;
  let wells = 0;
  for (let c = 0; c < COLS; c++) {
    let prev = 0;
    let seen = false;
    let run = 0;
    for (let r = 0; r < ROWS; r++) {
      const cur = g[r][c] !== 0 ? 1 : 0;
      if (cur !== prev) colT++;
      prev = cur;
      if (cur === 1) {
        seen = true;
        run = 0;
      } else {
        if (seen) holes++;
        const leftFilled = c === 0 || g[r][c - 1] !== 0;
        const rightFilled = c === COLS - 1 || g[r][c + 1] !== 0;
        if (leftFilled && rightFilled) {
          run++;
          wells += run;
        } else {
          run = 0;
        }
      }
    }
    if (prev === 0) colT++;
  }

  const base =
    W.landing * landing +
    W.eroded * eroded +
    W.rowT * rowT +
    W.colT * colT +
    W.holes * holes +
    W.wells * wells;

  const maxH = boardMaxHeight(g);
  const isSpin = type === 'T' && spinFinal && countTCorners(grid, x, y) >= 3;
  let bonus = 0;

  switch (st.strategy) {
    case 'survival':
      // とにかく低く安全に。消せるだけ消す
      bonus += cleared * 20;
      break;

    case 'tspin':
      if (isSpin) {
        // TSSは弱く、TSD/TSTを強烈に優遇して「2列揃うまで待つ」動機付け
        if (cleared === 1) bonus += 10;
        else if (cleared === 2) bonus += 260;
        else if (cleared >= 3) bonus += 500;
      } else if (cleared === 1 && maxH < 12) {
        bonus -= 4;
      } else if (cleared === 4) {
        bonus += 50;
      }
      bonus += tSlotBonus(g);
      break;

    case 'combo': {
      const inWell = cells.filter(([cx]) => cx < COMBO_WELL).length;
      if (st.phase === 'build') {
        // 左3列は聖域。右側を高く隙間なく積む
        bonus -= 45 * inWell;
        if (cleared > 0) bonus -= 25;
        if (maxH >= 14) bonus -= (maxH - 13) * 12;
      } else {
        // 連鎖フェーズ：毎手なにか消し続ける
        if (cleared > 0) bonus += 130;
        else if (inWell === 4) bonus += 16;
        else bonus -= 45;
      }
      break;
    }

    case 'tetris': {
      const inWell = cells.filter(([cx]) => cx === TETRIS_WELL).length;
      if (cleared >= 4) {
        bonus += 320;
      } else {
        bonus -= 60 * inWell;
        if (cleared > 0 && maxH < 14) bonus -= 30;
        bonus += readyRowsTetris(g) * 9;
        if (maxH >= 14) bonus += cleared * 15; // 高くなってきたら燃やして延命
      }
      break;
    }
  }

  return base + bonus;
}

interface Node {
  x: number;
  y: number;
  rot: number;
  parent: number;
  action: PathAction | null;
}

export interface BestResult {
  score: number;
  path: PathAction[];
  cleared: number;
  spin: boolean;
}

function stateKey(x: number, y: number, rot: number): number {
  return (rot * 48 + (y + 8)) * 48 + (x + 8);
}

export function findBest(
  grid: number[][],
  start: ActivePiece,
  allowDown: boolean,
  st: StrategyState,
): BestResult | null {
  const { type } = start;
  if (collides(grid, type, start.rot, start.x, start.y)) return null;

  const nodes: Node[] = [{ x: start.x, y: start.y, rot: start.rot, parent: -1, action: null }];
  const seen = new Set<number>([stateKey(start.x, start.y, start.rot)]);
  const placements = new Map<
    string,
    { nodeIdx: number; rot: number; x: number; y: number; spinFinal: boolean }
  >();

  for (let i = 0; i < nodes.length && nodes.length < 4000; i++) {
    const n = nodes[i];

    // このノードからハードドロップした先を設置候補として記録
    let py = n.y;
    while (!collides(grid, type, n.rot, n.x, py + 1)) py++;
    const cells = pieceCells(type, n.rot, n.x, py);
    const ck = cells
      .map(([a, b]) => a + b * COLS)
      .sort((p, q) => p - q)
      .join(',');
    const grounded = py === n.y;
    const spinFinal = grounded && (n.action === 'cw' || n.action === 'ccw');
    const existing = placements.get(ck);
    if (!existing) {
      placements.set(ck, { nodeIdx: i, rot: n.rot, x: n.x, y: py, spinFinal });
    } else if (spinFinal && !existing.spinFinal) {
      // 同じ設置位置でも「最後が回転」の経路を優先（T-spin成立のため）
      placements.set(ck, { nodeIdx: i, rot: n.rot, x: n.x, y: py, spinFinal: true });
    }

    const tryPush = (x: number, y: number, rot: number, action: PathAction) => {
      const k = stateKey(x, y, rot);
      if (seen.has(k)) return;
      seen.add(k);
      nodes.push({ x, y, rot, parent: i, action });
    };

    for (const dir of [1, -1] as const) {
      const r = attemptRotation(grid, { type, rot: n.rot, x: n.x, y: n.y }, dir);
      if (r) tryPush(r.x, r.y, r.rot, dir === 1 ? 'cw' : 'ccw');
    }
    for (const dx of [-1, 1]) {
      if (!collides(grid, type, n.rot, n.x + dx, n.y)) {
        tryPush(n.x + dx, n.y, n.rot, dx === -1 ? 'left' : 'right');
      }
    }
    if (allowDown && !collides(grid, type, n.rot, n.x, n.y + 1)) {
      tryPush(n.x, n.y + 1, n.rot, 'down');
    }
  }

  let best: {
    score: number;
    nodeIdx: number;
    p: { rot: number; x: number; y: number; spinFinal: boolean };
  } | null = null;
  for (const p of placements.values()) {
    const score = evaluatePlacement(grid, type, p.rot, p.x, p.y, p.spinFinal, st);
    if (!best || score > best.score) best = { score, nodeIdx: p.nodeIdx, p };
  }
  if (!best) return null;

  const path: PathAction[] = [];
  let idx = best.nodeIdx;
  while (idx >= 0) {
    const n = nodes[idx];
    if (n.action) path.push(n.action);
    idx = n.parent;
  }
  path.reverse();

  const cleared = linesIfPlaced(grid, pieceCells(type, best.p.rot, best.p.x, best.p.y));
  const spin =
    type === 'T' && best.p.spinFinal && countTCorners(grid, best.p.x, best.p.y) >= 3;
  return { score: best.score, path, cleared, spin };
}

export interface PlanResult {
  hold: boolean;
  path: PlanAction[];
  cleared: number;
  spin: boolean;
}

// ホールド活用込みの1手プラン（AutoPlayerとシミュレータの両方から使う）
export function planMove(game: Game, st: StrategyState, allowDown: boolean): PlanResult {
  const cur = findBest(game.grid, game.current, allowDown, st);
  let plan: PlanResult & { score: number } = cur
    ? {
        hold: false,
        path: [...cur.path, 'drop'],
        score: cur.score,
        cleared: cur.cleared,
        spin: cur.spin,
      }
    : { hold: false, path: ['drop'], score: -1e9, cleared: 0, spin: false };

  if (game.canHold) {
    const swap = game.holdType ?? game.nextTypes(1)[0];
    if (swap && swap !== game.current.type) {
      const alt = findBest(game.grid, spawnPiece(swap), allowDown, st);
      // 戦略上のキーピース（T/I）は多少不利でもホールドで温存する
      let threshold = 8;
      if (
        st.strategy === 'tspin' &&
        game.current.type === 'T' &&
        cur &&
        !(cur.spin && cur.cleared >= 2)
      ) {
        threshold = -45;
      }
      if (st.strategy === 'tetris' && game.current.type === 'I' && cur && cur.cleared < 4) {
        threshold = -45;
      }
      if (alt && alt.score > plan.score + threshold) {
        plan = { hold: true, path: [], score: alt.score, cleared: 0, spin: false };
      }
    }
  }
  return plan;
}

// comboモードのフェーズ判定：右側の高さで build ⇄ clear を行き来する
export function nextComboPhase(grid: number[][], phase: ComboPhase): ComboPhase {
  const hRight = boardMaxHeight(grid, COMBO_WELL, COLS - 1);
  if (phase === 'build' && hRight >= 10) return 'clear';
  if (phase === 'clear' && hRight <= 2) return 'build';
  return phase;
}

const BTN_OF: Record<PlanAction, Btn> = {
  left: 'left',
  right: 'right',
  down: 'down',
  cw: 'a',
  ccw: 'b',
  drop: 'up',
  hold: 'hold',
};

const ROTATION: StrategyId[] = ['tspin', 'combo', 'tetris'];
const PIECES_PER_STRATEGY = 30;

export class AutoPlayer {
  enabled = false;
  strategy: StrategyId = 'tspin';

  onStrategyChange?: (s: StrategyId) => void;
  onFeeling?: (category: string, n?: number) => void;

  private phase: ComboPhase = 'build';
  private piecesInStrategy = 0;
  private survival = false;
  private actions: PlanAction[] = [];
  private timer = 0;
  private pressedQueue: { btn: Btn; t: number }[] = [];

  constructor(
    private game: Game,
    private bus: InputBus,
  ) {
    game.on('spawn', () => this.replan());
    game.on('reset', () => {
      this.piecesInStrategy = 0;
      this.survival = false;
      this.phase = 'build';
    });
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (v) {
      this.onStrategyChange?.(this.strategy);
      this.replan();
    } else {
      this.actions = [];
    }
  }

  private rotateStrategy(): void {
    const others = ROTATION.filter((s) => s !== this.strategy);
    this.strategy = others[Math.floor(Math.random() * others.length)];
    this.piecesInStrategy = 0;
    this.phase = 'build';
    this.onStrategyChange?.(this.strategy);
  }

  private replan(): void {
    this.actions = [];
    if (!this.enabled) return;
    this.timer = 0.15; // 「考えている」間

    const g = this.game;
    if (g.over) return;

    this.piecesInStrategy++;
    if (this.piecesInStrategy > PIECES_PER_STRATEGY) this.rotateStrategy();

    // 危険検知 → 立て直しモード
    const maxH = boardMaxHeight(g.grid);
    if (!this.survival && maxH >= 16) {
      this.survival = true;
      this.onFeeling?.('danger');
    } else if (this.survival && maxH <= 9) {
      this.survival = false;
      this.onFeeling?.('recover');
    }

    if (this.strategy === 'combo' && !this.survival) {
      const np = nextComboPhase(g.grid, this.phase);
      if (np !== this.phase) {
        this.phase = np;
        this.onFeeling?.(np === 'clear' ? 'combo.go' : 'combo.build');
      }
    }

    const st: StrategyState = {
      strategy: this.survival ? 'survival' : this.strategy,
      phase: this.phase,
    };
    const allowDown = g.gravitySec() > 0.18;
    const plan = planMove(g, st, allowDown);

    if (plan.hold) {
      if (Math.random() < 0.35) this.onFeeling?.('hold.keep');
    } else if (plan.spin && plan.cleared >= 2) {
      this.onFeeling?.('tspin.execute');
    } else if (st.strategy === 'tspin' && Math.random() < 0.12) {
      this.onFeeling?.('tspin.build');
    } else if (st.strategy === 'tetris' && Math.random() < 0.12) {
      this.onFeeling?.(g.holdType === 'I' || plan.cleared >= 4 ? 'tetris.wait' : 'tetris.build');
    } else if (Math.random() < 0.06) {
      this.onFeeling?.('generic');
    }

    this.actions = plan.hold ? ['hold'] : plan.path;
  }

  step(dt: number): void {
    // ボタンリリース処理（無効化中も進める）
    this.pressedQueue = this.pressedQueue.filter((p) => {
      p.t -= dt;
      if (p.t <= 0) {
        this.bus.release(p.btn, 'ai');
        return false;
      }
      return true;
    });

    if (!this.enabled || !this.game.playing || this.game.over) return;
    this.timer -= dt;
    if (this.timer > 0 || this.actions.length === 0) return;

    const a = this.actions.shift()!;
    const btn = BTN_OF[a];
    this.bus.press(btn, 'ai');
    this.pressedQueue.push({ btn, t: 0.05 });

    const next = this.actions[0];
    if (a === 'down' && next === 'down') this.timer = 0.03;
    else if (a === 'down') this.timer = 0.05;
    else this.timer = 0.085 + Math.random() * 0.03;
  }
}
