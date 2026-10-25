/** Pure judge-tour timing and order. Visual only: the tour moves the camera and never decides business state. */
import { OFFICE_ANCHORS, type AnchorId } from "./state";
import { ROOM_SPAWNS, workspaceRoute, type Vec2 } from './layout';

/** Lobby, then the agent desks, then Dana, then Treasury. */
export const TOUR_ORDER: readonly AnchorId[] = ["lobby", "collections", "payables", "vendor_onboarding", "dana", "treasury"];
export const TOUR_MOVE_MS = 1400;
export const TOUR_DWELL_MS = 3000;
export const TOUR_STEP_MS = TOUR_MOVE_MS + TOUR_DWELL_MS;
/** Any of these on the window ends the tour. */
export const TOUR_INTERRUPT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

/** Visible rooms in tour order; hidden rooms are skipped. */
export function tourStops(visible: readonly AnchorId[]): AnchorId[] {
  return TOUR_ORDER.filter(room => visible.includes(room));
}

function clamp01(t: number): number {
  return Number.isNaN(t) ? 0 : Math.min(1, Math.max(0, t));
}
export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

/** Eased camera fraction for a move that started `elapsedMs` ago; reduced motion snaps to 1. */
export function tourProgress(elapsedMs: number, reduced: boolean): number {
  return reduced ? 1 : easeInOutCubic(elapsedMs / TOUR_MOVE_MS);
}

/** Route the aerial focus through the same clear aisles as the first-person story. */
export function tourRoute(from: Vec2, to: Vec2): Vec2[] {
  // CameraRig supplies logical anchors. Keep the kiosk interaction in place while the
  // tour's lobby stop surveys the office from the same entry band as Play/story.
  const entry = (point: Vec2): Vec2 => point[0] === OFFICE_ANCHORS.lobby.position[0] && point[1] === OFFICE_ANCHORS.lobby.position[1]
    ? ROOM_SPAWNS.lobby.position : point;
  from = entry(from);
  to = entry(to);
  const route = workspaceRoute(from, to);
  if (route.length > 1 || (from[0] === to[0] && from[1] === to[1])) return route;
  // Overview can focus inside furniture; enter the tour at the nearest clear approach.
  const approaches = Object.values(OFFICE_ANCHORS).map(anchor => entry(anchor.position));
  approaches.sort((a, b) => Math.hypot(a[0] - from[0], a[1] - from[1]) - Math.hypot(b[0] - from[0], b[1] - from[1]));
  return workspaceRoute(approaches[0]!, to);
}

/** Sample by travelled distance so unequal aisle legs share the existing move/easing time. */
export function tourRoutePoint(route: readonly Vec2[], progress: number): Vec2 {
  const lengths = route.slice(1).map((point, i) => Math.hypot(point[0] - route[i]![0], point[1] - route[i]![1]));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * clamp01(progress);
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (remaining <= length && length > 0) {
      const a = route[i]!, b = route[i + 1]!, fraction = remaining / length;
      return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
    }
    remaining -= length;
  }
  return route.at(-1)!;
}

/** Current stop index `elapsedMs` after the tour started, or null once every stop has had its move and dwell. */
export function tourIndexAt(elapsedMs: number, stopCount: number): number | null {
  if (!(stopCount > 0)) return null;
  const index = Math.floor(Math.max(0, Number.isNaN(elapsedMs) ? 0 : elapsedMs) / TOUR_STEP_MS);
  return index < stopCount ? index : null;
}

export function tourCaption(index: number, stops: readonly AnchorId[]): string {
  const room = stops[index];
  return room ? `Tour · ${index + 1} of ${stops.length} · ${OFFICE_ANCHORS[room].name} · press any key or click to stop` : "Tour";
}
