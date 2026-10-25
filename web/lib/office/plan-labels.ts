/** Pixel-space rectangles, shared by HTML plan/overview labels. */
export interface PlanRect { x: number; y: number; width: number; height: number }

export function planRectsOverlap(a: PlanRect, b: PlanRect, gap = 0): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** Nearest free placement beside a rect. Include earlier labels in obstacles.
 * Returns null when no placement fits; never silently overlaps or leaves the board.
 */
export function placePlanLabel(anchor: PlanRect, size: Pick<PlanRect, 'width' | 'height'>,
  bounds: PlanRect, obstacles: readonly PlanRect[], gap = 4): PlanRect | null {
  const { width, height } = size;
  const minX = bounds.x + gap, maxX = bounds.x + bounds.width - width - gap;
  const minY = bounds.y + gap, maxY = bounds.y + bounds.height - height - gap;
  if (maxX < minX || maxY < minY) return null;
  const cx = anchor.x + anchor.width / 2, cy = anchor.y + anchor.height / 2;
  const blocked = [anchor, ...obstacles];
  const xs = [minX, maxX, cx - width / 2, ...blocked.flatMap(r => [r.x - width - gap, r.x + r.width + gap])];
  const ys = [minY, maxY, cy - height / 2, ...blocked.flatMap(r => [r.y - height - gap, r.y + r.height + gap])];
  let best: PlanRect | null = null, distance = Infinity;
  for (const x0 of xs) for (const y0 of ys) {
    const x = Math.max(minX, Math.min(maxX, x0)), y = Math.max(minY, Math.min(maxY, y0));
    const candidate = { x, y, width, height };
    if (blocked.some(r => planRectsOverlap(candidate, r, gap - 0.01))) continue;
    const score = Math.hypot(x + width / 2 - cx, y + height / 2 - cy);
    if (score < distance) { best = candidate; distance = score; }
  }
  return best;
}
