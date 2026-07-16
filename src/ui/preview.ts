// ミノのミニプレビュー描画（HUD/VS-HUD共用）

import { COLORS, PieceType, SHAPES } from '../core/tetris';

export const cssColor = (hex: number) => '#' + hex.toString(16).padStart(6, '0');

export function drawMino(
  ctx: CanvasRenderingContext2D,
  type: PieceType,
  centerX: number,
  centerY: number,
  cell: number,
): void {
  const cells = SHAPES[type][0];
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  const w = (Math.max(...xs) - Math.min(...xs) + 1) * cell;
  const h = (Math.max(...ys) - Math.min(...ys) + 1) * cell;
  const ox = centerX - w / 2 - Math.min(...xs) * cell;
  const oy = centerY - h / 2 - Math.min(...ys) * cell;
  const color = cssColor(COLORS[type]);
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 9;
  ctx.fillStyle = color;
  for (const [x, y] of cells) {
    const px = ox + x * cell;
    const py = oy + y * cell;
    ctx.beginPath();
    ctx.roundRect(px + 1, py + 1, cell - 2, cell - 2, 3);
    ctx.fill();
  }
  ctx.restore();
}
