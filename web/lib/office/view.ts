/** Pure view decisions for the office viewport. Visual only: nothing here decides business state. */
export type ViewMode = "walk" | "tween" | "plan" | "play";

/** `sceneAttempt` identifies the mounted 3D scene; a new attempt means a fresh Canvas and WebGL context. */
export interface ViewportState {
  readonly mode: ViewMode;
  readonly lostContext: boolean;
  readonly sceneAttempt: number;
}
export type ViewportEvent =
  | { type: "pick"; mode: ViewMode }
  | { type: "prefer"; mode: ViewMode }
  | { type: "lost"; attempt: number }
  | { type: "restored"; attempt: number };

export const INITIAL_VIEWPORT: ViewportState = { mode: "tween", lostContext: false, sceneAttempt: 0 };

/**
 * `pick` is the user choosing a view: after a lost context it starts a new scene attempt instead of
 * re-showing the dead canvas. `prefer` is the initial device preference and never retries.
 * Loss and restore events from a previous attempt's canvas are ignored.
 */
export function viewportReducer(state: ViewportState, event: ViewportEvent): ViewportState {
  switch (event.type) {
    case "pick":
      return state.lostContext
        ? { mode: event.mode, lostContext: false, sceneAttempt: state.sceneAttempt + 1 }
        : state.mode === event.mode ? state : { ...state, mode: event.mode };
    case "prefer":
      return state.mode === event.mode ? state : { ...state, mode: event.mode };
    case "lost":
      return event.attempt === state.sceneAttempt && !state.lostContext ? { ...state, lostContext: true } : state;
    case "restored":
      return event.attempt === state.sceneAttempt && state.lostContext ? { ...state, lostContext: false } : state;
  }
}

/** What the viewport draws: the 3D scene (keyed by attempt) stays mounted but hidden while its context is lost. */
export interface ViewportLayers {
  readonly floorPlan: boolean;
  readonly scene: { readonly key: number; readonly visible: boolean } | null;
}
export function viewportLayers(state: ViewportState): ViewportLayers {
  if (state.mode === "plan") return { floorPlan: true, scene: null };
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
