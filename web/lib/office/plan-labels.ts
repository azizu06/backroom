/** Screen-space rectangles, shared by the floor plan and overview map. */
export interface PlanRect { x: number; y: number; width: number; height: number }
export interface PlanLabel {
  id: string;
  anchor: { x: number; y: number };
  /** The pod/fixture to label; prefer its free sides before above/below. */
  beside: PlanRect;
  width: number;
  height: number;
}
export interface PlacedPlanLabel extends PlanRect { id: string; anchor: PlanLabel['anchor'] }

export function planRectsOverlap(a: PlanRect, b: PlanRect, gap = 0): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

/** Shared collision checks and nearest-free obstacle-edge search for both views. */
function findPlanLabelPlacement(label: Omit<PlanLabel, 'id'>, bounds: PlanRect,
  obstacles: readonly PlanRect[], gap: number, preferSides: boolean): PlanRect | null {
  const { width, height, beside: pod, anchor } = label;
  const minX = bounds.x + gap, maxX = bounds.x + bounds.width - width - gap;
  const minY = bounds.y + gap, maxY = bounds.y + bounds.height - height - gap;
  if (maxX < minX || maxY < minY) return null;
  const clamp = (x: number, y: number): PlanRect => ({
    x: Math.max(minX, Math.min(maxX, x)), y: Math.max(minY, Math.min(maxY, y)), width, height,
  });
  const clear = (rect: PlanRect) => !obstacles.some(other => planRectsOverlap(rect, other, gap));
  if (preferSides) {
    const sides = [clamp(pod.x - width - gap, anchor.y - height / 2), clamp(pod.x + pod.width + gap, anchor.y - height / 2)];
    // Prefer the side with more free floor to the edge of the board.
    if (bounds.x + bounds.width - pod.x - pod.width > pod.x - bounds.x) sides.reverse();
    const candidates = [...sides, clamp(anchor.x - width / 2, pod.y - height - gap), clamp(anchor.x - width / 2, pod.y + pod.height + gap)];
    const preferred = candidates.find(clear);
    if (preferred) return preferred;
  }
  // Obstacle edges enumerate the free rectangular cells, without a resolution-dependent grid scan.
  const xs = [minX, maxX, anchor.x - width / 2,
    ...obstacles.flatMap(r => [r.x - width - gap, r.x + r.width + gap])];
  const ys = [minY, maxY, anchor.y - height / 2,
    ...obstacles.flatMap(r => [r.y - height - gap, r.y + r.height + gap])];
  let best: PlanRect | null = null, distance = Infinity;
  for (const x of xs) for (const y of ys) {
    const candidate = clamp(x, y);
    if (!clear(candidate)) continue;
    const score = Math.hypot(candidate.x + width / 2 - anchor.x, candidate.y + height / 2 - anchor.y);
    if (score < distance) { best = candidate; distance = score; }
  }
  return best;
}

/** Nearest free placement beside a rect. Include earlier labels in obstacles.
 * Returns null when no placement fits; never silently overlaps or leaves the board.
 */
export function placePlanLabel(anchor: PlanRect, size: Pick<PlanRect, 'width' | 'height'>,
  bounds: PlanRect, obstacles: readonly PlanRect[], gap = 4): PlanRect | null {
  return findPlanLabelPlacement({ ...size, beside: anchor,
    anchor: { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 },
  }, bounds, [anchor, ...obstacles], gap, false);
}

/** Deterministic placement. Never return a colliding label, even on an impossibly small board. */
export function placePlanLabels(labels: readonly PlanLabel[], bounds: PlanRect, obstacles: readonly PlanRect[], gap = 4): PlacedPlanLabel[] {
  const placed: PlacedPlanLabel[] = [];
  for (const label of labels) {
    const rect = findPlanLabelPlacement(label, bounds, [...obstacles, ...placed], gap, true);
    if (rect) placed.push({ ...rect, id: label.id, anchor: label.anchor });
  }
  return placed;
}
