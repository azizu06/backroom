import { describe, expect, it } from "vitest";
import {
  TOUR_DWELL_MS, TOUR_INTERRUPT_EVENTS, TOUR_MOVE_MS, TOUR_ORDER, TOUR_STEP_MS,
  easeInOutCubic, tourCaption, tourIndexAt, tourProgress, tourStops, tourRoute, tourRoutePoint,
} from "./tour";
import { OFFICE_ANCHORS, type AnchorId } from "./state";
import { ANCHOR_IDS, ROOM_SPAWNS, workspaceRoute, type Vec2 } from './layout';
import { CAMERA_CLEARANCE } from './metrics';
import { insideAny, officeColliders } from './play';

describe('aerial tour routing', () => {
  const colliders = officeColliders(ANCHOR_IDS);

  it('follows the clear grid route between every stop, including reverse or skipped stops', () => {
    for (const from of TOUR_ORDER) for (const to of TOUR_ORDER) {
      const a = from === 'lobby' ? ROOM_SPAWNS.lobby.position : OFFICE_ANCHORS[from].position;
      const b = to === 'lobby' ? ROOM_SPAWNS.lobby.position : OFFICE_ANCHORS[to].position;
      const route = tourRoute(OFFICE_ANCHORS[from].position, OFFICE_ANCHORS[to].position);
      expect(route).toEqual(workspaceRoute(a, b));
      expect(tourRoutePoint(route, 0)).toEqual(a);
      const end = tourRoutePoint(route, 1);
      expect(end[0]).toBeCloseTo(b[0]);
      expect(end[1]).toBeCloseTo(b[1]);
      for (let i = 0; i <= 200; i++) {
        expect(insideAny(tourRoutePoint(route, i / 200), colliders, CAMERA_CLEARANCE), `${from} → ${to}`).toBe(false);
      }
    }
  });

  it('can enter from the full-floor overview or a furniture-centred focus', () => {
    const starts: Vec2[] = [[0, 0], ...Object.values(OFFICE_ANCHORS).map(anchor => anchor.center)];
    for (const start of starts) {
      const route = tourRoute(start, OFFICE_ANCHORS.lobby.position);
      expect(route.at(-1)).toEqual(ROOM_SPAWNS.lobby.position);
      for (let i = 0; i <= 100; i++) expect(insideAny(tourRoutePoint(route, i / 100), colliders, CAMERA_CLEARANCE)).toBe(false);
    }
  });

  it('spends time in proportion to leg length and resumes an interrupted move on the grid', () => {
    expect(tourRoutePoint([[0, 0], [0, 1], [3, 1]], 0.5)).toEqual([1, 1]);
    const route = tourRoute(OFFICE_ANCHORS.collections.position, OFFICE_ANCHORS.payables.position);
    const midway = tourRoutePoint(route, 0.4);
    const resumed = tourRoute(midway, OFFICE_ANCHORS.dana.position);
    expect(resumed[0]).toEqual(midway);
    expect(resumed.at(-1)).toEqual(OFFICE_ANCHORS.dana.position);
    for (let i = 0; i <= 100; i++) expect(insideAny(tourRoutePoint(resumed, i / 100), colliders, CAMERA_CLEARANCE)).toBe(false);
  });
});

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
