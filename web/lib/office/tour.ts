/** Pure judge-tour timing and order. Visual only: the tour moves the camera and never decides business state. */
import { OFFICE_ANCHORS, type AnchorId } from "./state";

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
