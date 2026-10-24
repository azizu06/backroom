import { describe, expect, it } from "vitest";
import {
  TOUR_DWELL_MS, TOUR_INTERRUPT_EVENTS, TOUR_MOVE_MS, TOUR_ORDER, TOUR_STEP_MS,
  easeInOutCubic, tourCaption, tourIndexAt, tourProgress, tourStops,
} from "./tour";
import { OFFICE_ANCHORS, type AnchorId } from "./state";

describe("tour stops", () => {
  it("visits the lobby, the desks, Dana, then Treasury", () => {
    expect(TOUR_ORDER).toEqual(["lobby", "collections", "payables", "vendor_onboarding", "dana", "treasury"]);
    expect(new Set(TOUR_ORDER)).toEqual(new Set(Object.keys(OFFICE_ANCHORS)));
  });

  it("keeps the tour order regardless of the visible order", () => {
    const visible = [...TOUR_ORDER].reverse();
    expect(tourStops(visible)).toEqual(TOUR_ORDER);
  });

  it("skips hidden rooms", () => {
    expect(tourStops(["treasury", "lobby", "payables"])).toEqual(["lobby", "payables", "treasury"]);
    expect(tourStops([])).toEqual([]);
  });
});

describe("tour easing", () => {
  it("starts at 0, ends at 1 and passes the midpoint at half time", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
  });

  it("clamps out-of-range input", () => {
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
    expect(easeInOutCubic(Number.NaN)).toBe(0);
  });

  it("is monotonic", () => {
    let previous = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const value = easeInOutCubic(i / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("eases over the move time and snaps under reduced motion", () => {
    expect(tourProgress(0, false)).toBe(0);
    expect(tourProgress(TOUR_MOVE_MS / 2, false)).toBeCloseTo(0.5);
    expect(tourProgress(TOUR_MOVE_MS, false)).toBe(1);
    expect(tourProgress(TOUR_MOVE_MS * 3, false)).toBe(1);
    expect(tourProgress(0, true)).toBe(1);
    expect(tourProgress(-50, true)).toBe(1);
  });
});

describe("tour progression", () => {
  it("steps by move plus dwell time", () => {
    expect(TOUR_STEP_MS).toBe(TOUR_MOVE_MS + TOUR_DWELL_MS);
    expect(tourIndexAt(0, 6)).toBe(0);
    expect(tourIndexAt(TOUR_STEP_MS - 1, 6)).toBe(0);
    expect(tourIndexAt(TOUR_STEP_MS, 6)).toBe(1);
    expect(tourIndexAt(TOUR_STEP_MS * 5 + 10, 6)).toBe(5);
  });

  it("ends after the last stop's dwell", () => {
    expect(tourIndexAt(TOUR_STEP_MS * 6 - 1, 6)).toBe(5);
    expect(tourIndexAt(TOUR_STEP_MS * 6, 6)).toBeNull();
    expect(tourIndexAt(TOUR_STEP_MS, 1)).toBeNull();
  });

  it("has no stops without rooms and treats a skewed start as the first stop", () => {
    expect(tourIndexAt(0, 0)).toBeNull();
    expect(tourIndexAt(-500, 3)).toBe(0);
  });

  it("captions the current stop", () => {
    const stops: AnchorId[] = tourStops(TOUR_ORDER);
    expect(tourCaption(1, stops)).toBe("Tour · 2 of 6 · Collections · press any key or click to stop");
    expect(tourCaption(9, stops)).toBe("Tour");
  });

  it("is stopped by pointer, key, wheel and touch input", () => {
    expect(TOUR_INTERRUPT_EVENTS).toEqual(["pointerdown", "keydown", "wheel", "touchstart"]);
  });
});
