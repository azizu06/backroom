/** Pure view decisions for the office viewport. Visual only: nothing here decides business state. */
/**
 * The office is a first-person game: `play` is its only view mode. The tour and story mode are guided walks
 * that drive the same Play camera. The 2D floor plan is not a mode: it is drawn only while WebGL is lost or unavailable.
 */
export type ViewMode = "play";

/** `sceneAttempt` identifies the mounted 3D scene; a new attempt means a fresh Canvas and WebGL context. */
export interface ViewportState {
  readonly mode: ViewMode;
  readonly touring: boolean;
  readonly lostContext: boolean;
  readonly sceneAttempt: number;
}
export type ViewportEvent =
  | { type: "retry" }
  | { type: "lost"; attempt: number }
  | { type: "restored"; attempt: number }
  | { type: "startTour" }
  | { type: "endTour" };

export const INITIAL_VIEWPORT: ViewportState = { mode: "play", touring: false, lostContext: false, sceneAttempt: 0 };

/**
 * `retry` is the viewer asking for 3D again after a lost context: it starts a new scene attempt instead of
 * re-showing the dead canvas, and does nothing while the scene is healthy. Loss and restore events from a
 * previous attempt's canvas are ignored. A lost context ends a tour; starting a tour after one also retries.
 */
export function viewportReducer(state: ViewportState, event: ViewportEvent): ViewportState {
  switch (event.type) {
    case "retry":
      return state.lostContext ? { ...state, lostContext: false, sceneAttempt: state.sceneAttempt + 1 } : state;
    case "lost":
      return event.attempt === state.sceneAttempt && !state.lostContext ? { ...state, touring: false, lostContext: true } : state;
    case "restored":
      return event.attempt === state.sceneAttempt && state.lostContext ? { ...state, lostContext: false } : state;
    case "startTour":
      if (state.lostContext) return { ...state, touring: true, lostContext: false, sceneAttempt: state.sceneAttempt + 1 };
      return state.touring ? state : { ...state, touring: true };
    case "endTour":
      return state.touring ? { ...state, touring: false } : state;
  }
}

/** What the viewport draws: the 3D scene (keyed by attempt) stays mounted but hidden while its context is lost. */
export interface ViewportLayers {
  readonly floorPlan: boolean;
  readonly scene: { readonly key: number; readonly visible: boolean };
}
export function viewportLayers(state: ViewportState): ViewportLayers {
  return { floorPlan: state.lostContext, scene: { key: state.sceneAttempt, visible: !state.lostContext } };
}

/** Error-boundary state: a changed `resetKey` clears a failure so the children are retried. */
export interface BoundaryState {
  readonly failed: boolean;
  readonly resetKey?: unknown;
}
export function boundaryStateForProps(resetKey: unknown, state: BoundaryState): BoundaryState | null {
  return resetKey === state.resetKey ? null : { failed: false, resetKey };
}
/** A boundary without an `onFailure` handler still reports what failed. */
export function reportViewFailure(name: string, error: unknown, onFailure?: () => void, log: (...data: unknown[]) => void = console.error) {
  if (onFailure) onFailure();
  else log(`[office] ${name} failed to render`, error);
}

export const DOOR_FLASH_MS = 4500;
/** Denial door flash. Clock skew can put a row's `at` ahead of this clock; such rows count as just received. */
export function doorFlash(now: number, at: number | undefined): { visible: boolean; bright: boolean } {
  if (at === undefined) return { visible: false, bright: false };
  const age = Math.max(0, now - at);
  const visible = age < DOOR_FLASH_MS;
  return { visible, bright: visible && Math.floor(age / 300) % 2 === 0 };
}
