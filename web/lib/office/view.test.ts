import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createRequire } from "node:module";
import { MockOffice } from "../../app/office/Office";
import {
  DOOR_FLASH_MS, INITIAL_VIEWPORT, VIEW_OPTIONS, boundaryStateForProps, doorFlash, isFixedCamera, reportViewFailure, viewportLayers, viewportReducer,
  type ViewportEvent, type ViewportState,
} from "./view";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as { renderToStaticMarkup: (node: React.ReactElement) => string };
Object.assign(globalThis, { React });

describe("office camera picker", () => {
  it("offers distinct fixed and orbit cameras and an explicit pick leaves the fixed default", () => {
    expect(VIEW_OPTIONS).toContainEqual({ mode: "tween", label: "Fixed camera" });
    expect(VIEW_OPTIONS).toContainEqual({ mode: "walk", label: "Orbit Camera" });
    expect(new Set(VIEW_OPTIONS.map(option => option.mode)).size).toBe(VIEW_OPTIONS.length);
    const orbit = viewportReducer(INITIAL_VIEWPORT, { type: "pick", mode: "walk" });
    expect(orbit).not.toBe(INITIAL_VIEWPORT);
    expect(orbit.mode).toBe("walk");
    expect(isFixedCamera(orbit.mode)).toBe(false);
  });

  it("renders the real fixed default as the selected option with an actionable caption", () => {
    const html = renderToStaticMarkup(React.createElement(MockOffice));
    const select = html.slice(html.indexOf('id="office-view"'), html.indexOf('</select>'));
    expect(select).toContain('<option value="tween" selected="">Fixed camera</option>');
    expect(select).not.toContain('<option value="walk" selected="">');
    expect(html).toContain('Fixed camera · pick Orbit camera to look around</button>');
    expect(html).not.toContain('Drag to look around');
  });
});

/** Blank = no floor plan and either no scene or a visible scene whose WebGL context is lost. */
function expectNotBlank(state: ViewportState, lostAttempts: ReadonlySet<number>) {
  const layers = viewportLayers(state);
  if (layers.floorPlan) return;
  expect(layers.scene).not.toBeNull();
  expect(layers.scene!.visible).toBe(true);
  expect(lostAttempts.has(layers.scene!.key)).toBe(false);
}

describe("office viewport after a lost WebGL context", () => {
  const lost = viewportReducer(INITIAL_VIEWPORT, { type: "lost", attempt: 0 });

  it("shows the floor plan while the context is lost", () => {
    expect(lost.lostContext).toBe(true);
    expect(viewportLayers(lost)).toEqual({ floorPlan: true, scene: { key: 0, visible: false } });
  });

  it("picking the fixed or orbit camera mounts a fresh scene instead of the dead canvas", () => {
    for (const mode of ["tween", "walk", "tour"] as const) {
      const picked = viewportReducer(lost, { type: "pick", mode });
      const layers = viewportLayers(picked);
      expect(picked.mode).toBe(mode);
      expect(layers.floorPlan).toBe(false);
      expect(layers.scene).toEqual({ key: 1, visible: true });
      expectNotBlank(picked, new Set([0]));
    }
  });

  it("picking the floor plan shows it and the next 3D pick is a new attempt", () => {
    const plan = viewportReducer(lost, { type: "pick", mode: "plan" });
    expect(viewportLayers(plan)).toEqual({ floorPlan: true, scene: null });
    const back = viewportReducer(plan, { type: "pick", mode: "tween" });
    expect(viewportLayers(back).scene!.key).not.toBe(0);
  });

  it("ignores loss and restore events from a previous attempt's canvas", () => {
    const picked = viewportReducer(lost, { type: "pick", mode: "tween" });
    expect(viewportReducer(picked, { type: "lost", attempt: 0 })).toBe(picked);
    const lostAgain = viewportReducer(picked, { type: "lost", attempt: 1 });
    expect(viewportReducer(lostAgain, { type: "restored", attempt: 0 })).toBe(lostAgain);
    expect(viewportReducer(lostAgain, { type: "restored", attempt: 1 }).lostContext).toBe(false);
  });

  it("keeps the canvas while healthy: switching cameras does not rebuild the context", () => {
    const walk = viewportReducer(INITIAL_VIEWPORT, { type: "pick", mode: "walk" });
    expect(walk.sceneAttempt).toBe(0);
    expect(viewportReducer(lost, { type: "prefer", mode: "walk" })).toMatchObject({ lostContext: true, sceneAttempt: 0 });
  });

  it("is never blank across any short sequence of picks, losses and restores", () => {
    const events = (state: ViewportState): ViewportEvent[] => [
      { type: "pick", mode: "walk" }, { type: "pick", mode: "tween" }, { type: "pick", mode: "plan" }, { type: "pick", mode: "tour" },
      { type: "prefer", mode: "walk" }, { type: "endTour" },
      { type: "lost", attempt: state.sceneAttempt }, { type: "restored", attempt: state.sceneAttempt },
      { type: "lost", attempt: state.sceneAttempt - 1 }, { type: "restored", attempt: state.sceneAttempt - 1 },
    ];
    let checked = 0;
    function walk(state: ViewportState, lostAttempts: Set<number>, depth: number) {
      expectNotBlank(state, lostAttempts);
      checked += 1;
      if (!depth) return;
      for (const event of events(state)) {
        // Only the mounted (current, non-plan) canvas can lose or restore its context; stale attempts are already gone.
        const current = (event.type === "lost" || event.type === "restored") && event.attempt === state.sceneAttempt;
        if (current && state.mode === "plan") continue;
        const next = new Set(lostAttempts);
        if (event.type === "lost") next.add(event.attempt);
        if (event.type === "restored" && current) next.delete(event.attempt);
        walk(viewportReducer(state, event), next, depth - 1);
      }
    }
    walk(INITIAL_VIEWPORT, new Set(), 4);
    expect(checked).toBeGreaterThan(1000);
  });
});

describe("play view mode", () => {
  it("draws the 3D scene like the orbit and fixed cameras", () => {
    const play = viewportReducer(INITIAL_VIEWPORT, { type: "pick", mode: "play" });
    expect(play.mode).toBe("play");
    expect(play.sceneAttempt).toBe(0);
    expect(viewportLayers(play)).toEqual({ floorPlan: false, scene: { key: 0, visible: true } });
  });

  it("falls back to the floor plan on a lost context and picking Play again mounts a fresh scene", () => {
    const play = viewportReducer(INITIAL_VIEWPORT, { type: "pick", mode: "play" });
    const lost = viewportReducer(play, { type: "lost", attempt: 0 });
    expect(viewportLayers(lost)).toEqual({ floorPlan: true, scene: { key: 0, visible: false } });
    expect(viewportReducer(lost, { type: "restored", attempt: 0 })).toEqual(play);
    const again = viewportReducer(lost, { type: "pick", mode: "play" });
    expect(viewportLayers(again)).toEqual({ floorPlan: false, scene: { key: 1, visible: true } });
  });

  it("leaving Play for another camera keeps the healthy canvas", () => {
    const play = viewportReducer(INITIAL_VIEWPORT, { type: "pick", mode: "play" });
    expect(viewportReducer(play, { type: "pick", mode: "walk" })).toEqual({ mode: "walk", lostContext: false, sceneAttempt: 0 });
    expect(viewportReducer(play, { type: "pick", mode: "play" })).toBe(play);
  });
});

describe("tour view mode", () => {
  const tour = viewportReducer(INITIAL_VIEWPORT, { type: "pick", mode: "tour" });

  it("renders the 3D scene with the fixed camera like the fixed view", () => {
    expect(tour).toEqual({ mode: "tour", lostContext: false, sceneAttempt: 0 });
    expect(viewportLayers(tour)).toEqual({ floorPlan: false, scene: { key: 0, visible: true } });
    expect(isFixedCamera("tour")).toBe(true);
    expect(isFixedCamera("tween")).toBe(true);
    expect(isFixedCamera("walk")).toBe(false);
    expect(isFixedCamera("plan")).toBe(false);
  });

  it("ends on the fixed camera in the same scene attempt", () => {
    expect(viewportReducer(tour, { type: "endTour" })).toEqual({ mode: "tween", lostContext: false, sceneAttempt: 0 });
  });

  it("ignores endTour once another view was picked", () => {
    for (const mode of ["walk", "tween", "plan"] as const) {
      const picked = viewportReducer(tour, { type: "pick", mode });
      expect(viewportReducer(picked, { type: "endTour" })).toBe(picked);
    }
  });

  it("ends when the WebGL context is lost and does not retry the dead canvas", () => {
    const lost = viewportReducer(tour, { type: "lost", attempt: 0 });
    expect(lost).toEqual({ mode: "tween", lostContext: true, sceneAttempt: 0 });
    expect(viewportLayers(lost).floorPlan).toBe(true);
    expect(viewportReducer(lost, { type: "endTour" })).toBe(lost);
    expect(viewportReducer(tour, { type: "lost", attempt: 3 })).toBe(tour);
  });

  it("starting a tour after a lost context mounts a fresh scene", () => {
    const lost = viewportReducer(INITIAL_VIEWPORT, { type: "lost", attempt: 0 });
    const picked = viewportReducer(lost, { type: "pick", mode: "tour" });
    expect(picked).toEqual({ mode: "tour", lostContext: false, sceneAttempt: 1 });
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
