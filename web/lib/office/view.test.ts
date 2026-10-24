import { describe, expect, it, vi } from "vitest";
import {
  DOOR_FLASH_MS, INITIAL_VIEWPORT, boundaryStateForProps, doorFlash, reportViewFailure, viewportLayers, viewportReducer,
  type ViewportEvent, type ViewportState,
} from "./view";

/** Blank = no floor plan and a visible scene whose WebGL context is lost. */
function expectNotBlank(state: ViewportState, lostAttempts: ReadonlySet<number>) {
  const layers = viewportLayers(state);
  if (layers.floorPlan) return;
  expect(layers.scene.visible).toBe(true);
  expect(lostAttempts.has(layers.scene.key)).toBe(false);
}

describe("office viewport", () => {
  it("starts in Play with the 3D scene and no floor plan", () => {
    expect(INITIAL_VIEWPORT).toEqual({ mode: "play", touring: false, lostContext: false, sceneAttempt: 0 });
    expect(viewportLayers(INITIAL_VIEWPORT)).toEqual({ floorPlan: false, scene: { key: 0, visible: true } });
  });
});

describe("office viewport after a lost WebGL context", () => {
  const lost = viewportReducer(INITIAL_VIEWPORT, { type: "lost", attempt: 0 });

  it("shows the floor plan fallback while the context is lost", () => {
    expect(lost).toEqual({ mode: "play", touring: false, lostContext: true, sceneAttempt: 0 });
    expect(viewportLayers(lost)).toEqual({ floorPlan: true, scene: { key: 0, visible: false } });
  });

  it("a restore brings the same attempt back", () => {
    expect(viewportReducer(lost, { type: "restored", attempt: 0 })).toEqual(INITIAL_VIEWPORT);
  });

  it("retrying mounts a fresh scene instead of the dead canvas", () => {
    const retried = viewportReducer(lost, { type: "retry" });
    expect(retried).toEqual({ mode: "play", touring: false, lostContext: false, sceneAttempt: 1 });
    expect(viewportLayers(retried)).toEqual({ floorPlan: false, scene: { key: 1, visible: true } });
    expectNotBlank(retried, new Set([0]));
  });

  it("retrying a healthy scene keeps its canvas", () => {
    expect(viewportReducer(INITIAL_VIEWPORT, { type: "retry" })).toBe(INITIAL_VIEWPORT);
  });

  it("ignores loss and restore events from a previous attempt's canvas", () => {
    const retried = viewportReducer(lost, { type: "retry" });
    expect(viewportReducer(retried, { type: "lost", attempt: 0 })).toBe(retried);
    const lostAgain = viewportReducer(retried, { type: "lost", attempt: 1 });
    expect(viewportReducer(lostAgain, { type: "restored", attempt: 0 })).toBe(lostAgain);
    expect(viewportReducer(lostAgain, { type: "restored", attempt: 1 }).lostContext).toBe(false);
  });

  it("is never blank across any short sequence of retries, tours, losses and restores", () => {
    const events = (state: ViewportState): ViewportEvent[] => [
      { type: "retry" }, { type: "startTour" }, { type: "endTour" },
      { type: "lost", attempt: state.sceneAttempt }, { type: "restored", attempt: state.sceneAttempt },
      { type: "lost", attempt: state.sceneAttempt - 1 }, { type: "restored", attempt: state.sceneAttempt - 1 },
    ];
    let checked = 0;
    function walk(state: ViewportState, lostAttempts: Set<number>, depth: number) {
      expectNotBlank(state, lostAttempts);
      checked += 1;
      if (!depth) return;
      for (const event of events(state)) {
        // Only the mounted canvas can lose or restore its context; stale attempts are already gone.
        const current = (event.type === "lost" || event.type === "restored") && event.attempt === state.sceneAttempt;
        const next = new Set(lostAttempts);
        if (event.type === "lost") next.add(event.attempt);
        if (event.type === "restored" && current) next.delete(event.attempt);
        walk(viewportReducer(state, event), next, depth - 1);
      }
    }
    walk(INITIAL_VIEWPORT, new Set(), 5);
    expect(checked).toBeGreaterThan(1000);
  });
});

describe("guided tour", () => {
  const tour = viewportReducer(INITIAL_VIEWPORT, { type: "startTour" });

  it("runs in Play over the same scene attempt", () => {
    expect(tour).toEqual({ mode: "play", touring: true, lostContext: false, sceneAttempt: 0 });
    expect(viewportLayers(tour)).toEqual({ floorPlan: false, scene: { key: 0, visible: true } });
    expect(viewportReducer(tour, { type: "startTour" })).toBe(tour);
  });

  it("ends back in Play in the same scene attempt", () => {
    expect(viewportReducer(tour, { type: "endTour" })).toEqual(INITIAL_VIEWPORT);
    expect(viewportReducer(INITIAL_VIEWPORT, { type: "endTour" })).toBe(INITIAL_VIEWPORT);
  });

  it("ends when the WebGL context is lost and does not retry the dead canvas", () => {
    const lost = viewportReducer(tour, { type: "lost", attempt: 0 });
    expect(lost).toEqual({ mode: "play", touring: false, lostContext: true, sceneAttempt: 0 });
    expect(viewportLayers(lost).floorPlan).toBe(true);
    expect(viewportReducer(lost, { type: "endTour" })).toBe(lost);
    expect(viewportReducer(tour, { type: "lost", attempt: 3 })).toBe(tour);
  });

  it("starting a tour after a lost context mounts a fresh scene", () => {
    const lost = viewportReducer(INITIAL_VIEWPORT, { type: "lost", attempt: 0 });
    expect(viewportReducer(lost, { type: "startTour" })).toEqual({ mode: "play", touring: true, lostContext: false, sceneAttempt: 1 });
  });
});

describe("view boundary reset and fallback", () => {
  it("stays failed for the same reset key and retries when the key changes", () => {
    const row = {};
    const initial = { failed: false, resetKey: row };
    expect(boundaryStateForProps(row, initial)).toBeNull();
    const failed = { failed: true, resetKey: row };
    expect(boundaryStateForProps(row, failed)).toBeNull();
    const next = {};
    expect(boundaryStateForProps(next, failed)).toEqual({ failed: false, resetKey: next });
  });

  it("calls onFailure when given, otherwise logs the error with the region name", () => {
    const error = new Error("bad row");
    const onFailure = vi.fn();
    const log = vi.fn();
    reportViewFailure("Audit wall", error, onFailure, log);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
    reportViewFailure("Audit wall", error, undefined, log);
    expect(log).toHaveBeenCalledWith("[office] Audit wall failed to render", error);
  });
});

describe("denial door flash", () => {
  it("flashes for the window after the denial and then hides", () => {
    expect(doorFlash(1_000, undefined)).toEqual({ visible: false, bright: false });
    expect(doorFlash(1_000, 1_000)).toEqual({ visible: true, bright: true });
    expect(doorFlash(1_300, 1_000)).toEqual({ visible: true, bright: false });
    expect(doorFlash(1_000 + DOOR_FLASH_MS, 1_000).visible).toBe(false);
  });

  it("treats a denial stamped ahead of this clock (skew) as just received", () => {
    expect(doorFlash(1_000, 3_000)).toEqual({ visible: true, bright: true });
    expect(doorFlash(3_000 + DOOR_FLASH_MS, 3_000).visible).toBe(false);
  });
});
