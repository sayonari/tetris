// テトリス コアロジック
// ガイドライン準拠：SRS回転（ウォールキック）・7バッグ・ホールド・ロックディレイ・
// T-spin（3コーナールール）・B2B・コンボ・パーフェクトクリア

export type PieceType = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export type Cell = [number, number];

export const COLS = 10;
export const VISIBLE = 20;
export const HIDDEN = 4;
export const ROWS = HIDDEN + VISIBLE;

export const PIECE_TYPES: PieceType[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

// 標準配色
export const COLORS: Record<PieceType, number> = {
  I: 0x00f0f0,
  O: 0xf0f000,
  T: 0xa000f0,
  S: 0x00f000,
  Z: 0xf00000,
  J: 0x0000f0,
  L: 0xf0a000,
};

export const GARBAGE_INDEX = 8; // せり上がりブロック（グレー）
export const COLOR_BY_INDEX: number[] = [0, ...PIECE_TYPES.map((t) => COLORS[t]), 0x6a7285];

export function colorIndexOf(type: PieceType): number {
  return PIECE_TYPES.indexOf(type) + 1;
}

// 各ミノのスポーン状態（バウンディングボックス内 y下向き）
const BASE: Record<PieceType, { n: number; cells: Cell[] }> = {
  I: { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  O: { n: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  T: { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  S: { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  Z: { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  J: { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
};

// 4回転分のセル座標を事前計算（SRSの回転状態と一致）
export const SHAPES: Record<PieceType, Cell[][]> = {} as Record<PieceType, Cell[][]>;
for (const t of PIECE_TYPES) {
  const { n, cells } = BASE[t];
  const rots: Cell[][] = [cells];
  for (let r = 1; r < 4; r++) {
    rots.push(rots[r - 1].map(([x, y]) => [n - 1 - y, x] as Cell));
  }
  SHAPES[t] = rots;
}

// SRSキックテーブル（y上向き規約。適用時にyを反転する）
type KickTable = Record<string, Cell[]>;
const KICKS_JLSTZ: KickTable = {
  '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};
const KICKS_I: KickTable = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

export interface ActivePiece {
  type: PieceType;
  rot: number;
  x: number;
  y: number;
}

export function spawnPiece(type: PieceType): ActivePiece {
  return { type, rot: 0, x: type === 'O' ? 4 : 3, y: 2 };
}

export function pieceCells(type: PieceType, rot: number, x: number, y: number): Cell[] {
  return SHAPES[type][rot].map(([cx, cy]) => [x + cx, y + cy] as Cell);
}

export function collides(
  grid: number[][],
  type: PieceType,
  rot: number,
  x: number,
  y: number,
): boolean {
  for (const [cx, cy] of SHAPES[type][rot]) {
    const wx = x + cx;
    const wy = y + cy;
    if (wx < 0 || wx >= COLS || wy >= ROWS) return true;
    if (wy >= 0 && grid[wy][wx] !== 0) return true;
  }
  return false;
}

export function canMove(grid: number[][], p: ActivePiece, dx: number, dy: number): boolean {
  return !collides(grid, p.type, p.rot, p.x + dx, p.y + dy);
}

export interface RotationResult {
  rot: number;
  x: number;
  y: number;
  kick: number;
}

// SRSウォールキック付き回転を試す（成功時は新しい姿勢を返す）
export function attemptRotation(
  grid: number[][],
  p: ActivePiece,
  dir: 1 | -1,
): RotationResult | null {
  if (p.type === 'O') return null;
  const from = p.rot;
  const to = (p.rot + dir + 4) % 4;
  const table = p.type === 'I' ? KICKS_I : KICKS_JLSTZ;
  const kicks = table[`${from}>${to}`];
  for (let i = 0; i < kicks.length; i++) {
    const [dx, dy] = kicks[i];
    const nx = p.x + dx;
    const ny = p.y - dy; // y上向きテーブル→y下向きグリッド
    if (!collides(grid, p.type, to, nx, ny)) {
      return { rot: to, x: nx, y: ny, kick: i };
    }
  }
  return null;
}

export function emptyGrid(): number[][] {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

// 揃った行のインデックスを返し、グリッドから取り除く
export function clearFullRows(grid: number[][]): number[] {
  const full: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    if (grid[r].every((c) => c !== 0)) full.push(r);
  }
  for (const r of full) {
    grid.splice(r, 1);
    grid.unshift(Array(COLS).fill(0));
  }
  return full;
}

export interface ClearInfo {
  lines: number;
  rows: number[];
  tspin: boolean;
  mini: boolean;
  b2b: boolean;
  combo: number;
  pc: boolean;
  points: number;
}

export interface GameStats {
  pieces: number;
  tetris: number;
  tspins: number;
  maxCombo: number;
  time: number;
}

type Handler = (payload?: unknown) => void;

class Emitter {
  private handlers = new Map<string, Set<Handler>>();
  on(ev: string, fn: Handler): void {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set());
    this.handlers.get(ev)!.add(fn);
  }
  emit(ev: string, payload?: unknown): void {
    const set = this.handlers.get(ev);
    if (set) for (const fn of set) fn(payload);
  }
}

const LOCK_DELAY = 0.5;
const MAX_LOCK_RESETS = 15;

export class Game extends Emitter {
  grid: number[][] = emptyGrid();
  current: ActivePiece = spawnPiece('T');
  holdType: PieceType | null = null;
  canHold = true;
  queue: PieceType[] = [];
  private bag: PieceType[] = [];

  score = 0;
  lines = 0;
  level = 1;
  combo = -1;
  b2b = false;

  playing = false;
  over = false;

  stats: GameStats = { pieces: 0, tetris: 0, tspins: 0, maxCombo: 0, time: 0 };

  private gravityAcc = 0;
  private lockTimer = 0;
  private lockResets = 0;
  private softDropping = false;
  private lastRotate = false;
  private lastKick = 0;

  // 対戦用：受けているせり上がり（バッチごとに穴位置を持つ）
  private garbageQueue: { rows: number; hole: number }[] = [];

  constructor() {
    super();
    this.reset();
  }

  reset(): void {
    this.grid = emptyGrid();
    this.holdType = null;
    this.canHold = true;
    this.queue = [];
    this.bag = [];
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.combo = -1;
    this.b2b = false;
    this.playing = false;
    this.over = false;
    this.stats = { pieces: 0, tetris: 0, tspins: 0, maxCombo: 0, time: 0 };
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.softDropping = false;
    this.lastRotate = false;
    this.garbageQueue = [];
    this.spawnNext();
    this.emit('reset');
    this.emit('score');
  }

  // ---- 対戦（せり上がり） ----

  garbagePending(): number {
    return this.garbageQueue.reduce((s, g) => s + g.rows, 0);
  }

  // 相手からの攻撃を受け取る（次のロック後にせり上がる）
  addGarbage(rows: number): void {
    if (rows <= 0) return;
    this.garbageQueue.push({ rows, hole: Math.floor(Math.random() * COLS) });
    this.emit('garbagewarn', this.garbagePending());
  }

  // 自分の攻撃でまず受けを相殺し、残った攻撃力を返す
  cancelGarbage(power: number): number {
    while (power > 0 && this.garbageQueue.length > 0) {
      const head = this.garbageQueue[0];
      const used = Math.min(power, head.rows);
      head.rows -= used;
      power -= used;
      if (head.rows === 0) this.garbageQueue.shift();
    }
    this.emit('garbagewarn', this.garbagePending());
    return power;
  }

  // ロック後（ライン消去なしの時）にせり上げを適用
  private applyGarbage(): void {
    let toApply = Math.min(this.garbagePending(), 8); // 1回のせり上げ上限
    if (toApply <= 0) return;
    let applied = 0;
    while (toApply > 0 && this.garbageQueue.length > 0) {
      const head = this.garbageQueue[0];
      const n = Math.min(toApply, head.rows);
      for (let i = 0; i < n; i++) {
        this.grid.shift();
        const row = Array(COLS).fill(GARBAGE_INDEX);
        row[head.hole] = 0;
        this.grid.push(row);
      }
      head.rows -= n;
      toApply -= n;
      applied += n;
      if (head.rows === 0) this.garbageQueue.shift();
    }
    this.emit('garbage', applied);
    this.emit('garbagewarn', this.garbagePending());
  }

  gravitySec(): number {
    const l = Math.min(this.level, 19);
    const s = Math.pow(0.8 - (l - 1) * 0.007, l - 1);
    return Math.max(s, 0.005);
  }

  nextTypes(n: number): PieceType[] {
    this.ensureQueue(n);
    return this.queue.slice(0, n);
  }

  step(dt: number): void {
    if (!this.playing || this.over) return;
    this.stats.time += dt;

    let g = this.gravitySec();
    if (this.softDropping) g = Math.min(g / 20, 0.035);
    this.gravityAcc += dt;
    while (this.gravityAcc >= g) {
      this.gravityAcc -= g;
      if (canMove(this.grid, this.current, 0, 1)) {
        this.current.y++;
        this.lastRotate = false;
        if (this.softDropping) this.addScore(1);
        this.emit('fall');
      } else {
        this.gravityAcc = 0;
        break;
      }
    }

    if (!canMove(this.grid, this.current, 0, 1)) {
      this.lockTimer += dt;
      if (this.lockTimer >= LOCK_DELAY) this.lockNow();
    } else {
      this.lockTimer = 0;
    }
  }

  moveLeft(): boolean {
    return this.shift(-1);
  }

  moveRight(): boolean {
    return this.shift(1);
  }

  private shift(dx: number): boolean {
    if (!this.playing || this.over) return false;
    if (!canMove(this.grid, this.current, dx, 0)) return false;
    this.current.x += dx;
    this.lastRotate = false;
    this.resetLock();
    this.emit('move');
    return true;
  }

  rotate(dir: 1 | -1): boolean {
    if (!this.playing || this.over) return false;
    const r = attemptRotation(this.grid, this.current, dir);
    if (!r) return false;
    this.current.rot = r.rot;
    this.current.x = r.x;
    this.current.y = r.y;
    this.lastRotate = true;
    this.lastKick = r.kick;
    this.resetLock();
    this.emit('rotate');
    return true;
  }

  setSoftDrop(v: boolean): void {
    this.softDropping = v;
  }

  // AI用：1セルだけソフトドロップ
  nudgeDown(): boolean {
    if (!this.playing || this.over) return false;
    if (!canMove(this.grid, this.current, 0, 1)) return false;
    this.current.y++;
    this.lastRotate = false;
    this.addScore(1);
    this.emit('fall');
    return true;
  }

  hardDrop(): void {
    if (!this.playing || this.over) return;
    let d = 0;
    while (canMove(this.grid, this.current, 0, 1)) {
      this.current.y++;
      d++;
    }
    if (d > 0) {
      this.addScore(d * 2);
      this.lastRotate = false;
    }
    this.emit('harddrop', { dist: d });
    this.lockNow();
  }

  hold(): boolean {
    if (!this.playing || this.over || !this.canHold) return false;
    this.canHold = false;
    const prev = this.holdType;
    this.holdType = this.current.type;
    this.emit('hold');
    this.spawnNext(prev ?? undefined);
    return true;
  }

  ghostDistance(): number {
    let d = 0;
    while (canMove(this.grid, this.current, 0, d + 1)) d++;
    return d;
  }

  private resetLock(): void {
    if (!canMove(this.grid, this.current, 0, 1) && this.lockResets < MAX_LOCK_RESETS) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  private addScore(n: number): void {
    this.score += n;
    this.emit('score');
  }

  private ensureQueue(n: number): void {
    while (this.queue.length < Math.max(n, 8)) {
      if (this.bag.length === 0) {
        this.bag = [...PIECE_TYPES];
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
        }
      }
      this.queue.push(this.bag.pop()!);
    }
  }

  private takeNext(): PieceType {
    this.ensureQueue(1);
    return this.queue.shift()!;
  }

  private spawnNext(type?: PieceType): void {
    const t = type ?? this.takeNext();
    this.current = spawnPiece(t);
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.lastRotate = false;
    const blocked = collides(this.grid, t, 0, this.current.x, this.current.y);
    this.emit('spawn');
    if (blocked) this.gameOver();
  }

  private lockNow(): void {
    const { type, rot, x, y } = this.current;
    const cells = pieceCells(type, rot, x, y);

    // T-spin判定（設置前のグリッドで3コーナールール）
    let tspin = false;
    let mini = false;
    if (type === 'T' && this.lastRotate) {
      const corners: Cell[] = [
        [x, y],
        [x + 2, y],
        [x, y + 2],
        [x + 2, y + 2],
      ];
      const occ = corners.map(
        ([cx, cy]) =>
          cx < 0 || cx >= COLS || cy >= ROWS || (cy >= 0 && this.grid[cy][cx] !== 0),
      );
      const filled = occ.filter(Boolean).length;
      if (filled >= 3) {
        tspin = true;
        const frontIdx =
          rot === 0 ? [0, 1] : rot === 1 ? [1, 3] : rot === 2 ? [2, 3] : [0, 2];
        const frontFilled = occ[frontIdx[0]] && occ[frontIdx[1]];
        mini = !frontFilled && this.lastKick !== 4;
      }
    }

    const colorIdx = colorIndexOf(type);
    for (const [cx, cy] of cells) {
      if (cy >= 0) this.grid[cy][cx] = colorIdx;
    }
    this.stats.pieces++;

    const lockout = cells.every(([, cy]) => cy < HIDDEN);

    const rowsCleared = clearFullRows(this.grid);
    const lines = rowsCleared.length;

    let points = 0;
    let b2bNow = false;
    let pc = false;

    if (lines > 0 || tspin) {
      let base: number;
      if (tspin) {
        base = mini ? [100, 200, 400, 400][lines] : [400, 800, 1200, 1600][lines];
      } else {
        base = [0, 100, 300, 500, 800][lines];
      }
      const difficult = lines > 0 && (lines === 4 || tspin);
      b2bNow = difficult && this.b2b;
      points = Math.floor(base * (b2bNow ? 1.5 : 1)) * this.level;

      if (lines > 0) {
        this.combo++;
        points += 50 * Math.max(this.combo, 0) * this.level;
        this.b2b = difficult;
        pc = this.grid.every((row) => row.every((c) => c === 0));
        if (pc) points += [800, 1200, 1800, 2000][lines - 1] * this.level;
      }
    }
    if (lines === 0) this.combo = -1;

    if (points > 0) this.addScore(points);
    this.lines += lines;
    if (lines === 4) this.stats.tetris++;
    if (tspin) this.stats.tspins++;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);

    this.emit('lock', { type, cells });

    if (lines > 0 || tspin) {
      const info: ClearInfo = {
        lines,
        rows: rowsCleared,
        tspin,
        mini,
        b2b: b2bNow,
        combo: this.combo,
        pc,
        points,
      };
      this.emit('clear', info);
    }

    const newLevel = Math.floor(this.lines / 10) + 1;
    if (newLevel > this.level) {
      this.level = newLevel;
      this.emit('levelup', this.level);
    }
    this.emit('score');

    if (lockout) {
      this.gameOver();
      return;
    }

    // 消去できなかったターンにせり上がりが入る（ガイドライン系対戦の標準挙動）
    if (lines === 0) this.applyGarbage();

    this.canHold = true;
    this.spawnNext();
  }

  private gameOver(): void {
    this.playing = false;
    this.over = true;
    this.emit('gameover', { score: this.score, stats: this.stats });
  }
}
