// 対戦モードの調停：攻撃力計算・相殺・せり上がり送信・勝敗判定

import { ClearInfo, Game } from '../core/tetris';

// コンボボーナス（ガイドライン系標準テーブル）
const COMBO_ATTACK = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5];

// 消去の攻撃力（送るせり上がり行数）
export function attackOf(info: ClearInfo): number {
  if (info.lines === 0) return 0;
  let atk: number;
  if (info.tspin) {
    atk = info.mini ? [0, 0, 1, 2][info.lines] : [0, 2, 4, 6][info.lines];
  } else {
    atk = [0, 0, 1, 2, 4][info.lines];
  }
  if (info.b2b && atk > 0) atk += 1;
  atk += COMBO_ATTACK[Math.min(Math.max(info.combo, 0), COMBO_ATTACK.length - 1)];
  if (info.pc) atk += 10;
  return atk;
}

export interface AttackEvent {
  from: number; // プレイヤー番号（0/1）
  to: number;
  power: number; // 相殺後に実際に送られた行数
  raw: number; // 相殺前の攻撃力
}

export class Battle {
  onAttack?: (e: AttackEvent) => void;
  onWinner?: (winner: number) => void;

  private finished = false;

  constructor(private games: [Game, Game]) {
    games.forEach((g, i) => {
      g.on('clear', (p) => this.handleClear(i, p as ClearInfo));
      g.on('gameover', () => this.handleGameOver(i));
    });
  }

  private handleClear(from: number, info: ClearInfo): void {
    if (this.finished) return;
    const raw = attackOf(info);
    if (raw <= 0) return;
    // まず自分が受けている分を相殺し、残りを相手へ
    const remain = this.games[from].cancelGarbage(raw);
    const to = 1 - from;
    if (remain > 0) this.games[to].addGarbage(remain);
    this.onAttack?.({ from, to, power: remain, raw });
  }

  private handleGameOver(loser: number): void {
    if (this.finished) return;
    this.finished = true;
    const winner = 1 - loser;
    this.games[winner].playing = false;
    this.onWinner?.(winner);
  }
}
