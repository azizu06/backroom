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

/** Deterministic placement. Never return a colliding label, even on an impossibly small board. */
export function placePlanLabels(labels: readonly PlanLabel[], bounds: PlanRect, obstacles: readonly PlanRect[], gap = 4): PlacedPlanLabel[] {
  const placed: PlacedPlanLabel[] = [];
  for (const label of labels) {
    const { width, height, beside: pod, anchor } = label;
    const clamp = (x: number, y: number): PlanRect => ({
      x: Math.max(bounds.x + gap, Math.min(bounds.x + bounds.width - width - gap, x)),
      y: Math.max(bounds.y + gap, Math.min(bounds.y + bounds.height - height - gap, y)), width, height,
    });
    const clear = (rect: PlanRect) => rect.x >= bounds.x + gap && rect.y >= bounds.y + gap
      && rect.x + width <= bounds.x + bounds.width - gap && rect.y + height <= bounds.y + bounds.height - gap
      && ![...obstacles, ...placed].some(other => planRectsOverlap(rect, other, gap));
    const sides = [clamp(pod.x - width - gap, anchor.y - height / 2), clamp(pod.x + pod.width + gap, anchor.y - height / 2)];
    // Prefer the side with more free floor to the edge of the board.
    if (bounds.x + bounds.width - pod.x - pod.width > pod.x - bounds.x) sides.reverse();
    const candidates = [...sides, clamp(anchor.x - width / 2, pod.y - height - gap), clamp(anchor.x - width / 2, pod.y + pod.height + gap)];
    let rect = candidates.find(clear);
    if (!rect) {
      // Obstacle edges enumerate the free rectangular cells, without a resolution-dependent grid scan.
      const occupied = [...obstacles, ...placed];
      const xs = [bounds.x + gap, bounds.x + bounds.width - width - gap, anchor.x - width / 2,
        ...occupied.flatMap(r => [r.x - width - gap, r.x + r.width + gap])];
      const ys = [bounds.y + gap, bounds.y + bounds.height - height - gap, anchor.y - height / 2,
        ...occupied.flatMap(r => [r.y - height - gap, r.y + r.height + gap])];
      rect = xs.flatMap(x => ys.map(y => clamp(x, y))).filter(clear)
        .sort((a, b) => Math.hypot(a.x + width / 2 - anchor.x, a.y + height / 2 - anchor.y)
          - Math.hypot(b.x + width / 2 - anchor.x, b.y + height / 2 - anchor.y))[0];
    }
    if (rect) placed.push({ ...rect, id: label.id, anchor });
  }
  return placed;
}
