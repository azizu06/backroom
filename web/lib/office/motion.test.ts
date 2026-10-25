import { describe, expect, it } from "vitest";
import { MotionRegistry, WalkMotion } from "./motion";
import type { AnchorId } from "./state";
import { createMockOfficeState } from "./preview";
import { CORRIDOR_Z } from "./layout";
import { OFFICE_ANCHORS as ANCHORS } from "./state";

const COLLECTIONS = ANCHORS.collections.position, DANA = ANCHORS.dana.position, PAYABLES = ANCHORS.payables.position;

describe("office row → view contract", () => {
  it("publishes an immutable target change and stops notifying after unsubscribe", () => {
    const mock = createMockOfficeState();
    const initial = mock.source.getSnapshot();
    let notifications = 0;
    const unsubscribe = mock.source.subscribe(() => { notifications += 1; });
    mock.setTargetAnchor("dana");
    expect(notifications).toBe(1);
    expect(initial.agents[0]!.targetAnchor).toBe("collections");
    const changed = mock.source.getSnapshot();
    expect(changed.agents[0]!.targetAnchor).toBe("dana");
    expect(mock.source.getSnapshot()).toBe(changed);
    mock.setTargetAnchor("dana");
    expect(notifications).toBe(1);
    unsubscribe();
    mock.setTargetAnchor("collections");
    expect(notifications).toBe(1);
  });

  it("walks continuously through the aisle and reaches the requested desk", () => {
    const walk = new WalkMotion(COLLECTIONS);
    walk.moveTo("dana");
    expect(walk.position).toEqual(COLLECTIONS);
    let crossedAisle = false;
    for (let frame = 0; frame < 360; frame += 1) {
      const previous = [...walk.position];
      walk.advance(1 / 60);
      expect(Math.hypot(walk.position[0] - previous[0]!, walk.position[1] - previous[1]!)).toBeLessThanOrEqual(2.4 / 60 + 1e-6);
      if (walk.position[0] > COLLECTIONS[0] + 1 && walk.position[0] < DANA[0] - 1) {
        expect(walk.position[1]).toBeCloseTo(CORRIDOR_Z);
        crossedAisle = true;
      }
    }
    expect(crossedAisle).toBe(true);
    expect(walk.position).toEqual(DANA);
    expect(walk.moving).toBe(false);
  });

  it("retargets mid-walk without resetting position and clamps a resumed frame", () => {
    const walk = new WalkMotion(COLLECTIONS);
    walk.moveTo("dana");
    for (let frame = 0; frame < 90; frame += 1) walk.advance(1 / 60);
    const before = [...walk.position];
    walk.moveTo("collections");
    expect(walk.position).toEqual(before);
    walk.advance(10);
    expect(Math.hypot(walk.position[0] - before[0]!, walk.position[1] - before[1]!)).toBeLessThanOrEqual(0.24 + 1e-6);
    for (let frame = 0; frame < 360; frame += 1) walk.advance(1 / 60);
    expect(walk.position).toEqual(COLLECTIONS);
  });
});

describe("unknown anchors from live rows", () => {
  it("treats moveTo with an unknown anchor as a no-op that leaves the agent standing", () => {
    const walk = new WalkMotion(COLLECTIONS);
    expect(() => walk.moveTo("Dana_desk")).not.toThrow();
    expect(walk.moving).toBe(false);
    walk.advance(1);
    expect(walk.position).toEqual(COLLECTIONS);
    for (const anchor of ["", "constructor", "__proto__", "toString"]) expect(() => walk.moveTo(anchor)).not.toThrow();
    expect(walk.position).toEqual(COLLECTIONS);
    expect(walk.moving).toBe(false);
  });

  it("does not throw when the registry syncs a row with an unknown anchor", () => {
    const registry = new MotionRegistry();
    const agent = { id: "live-1", pos: PAYABLES, targetAnchor: "Dana_desk" as AnchorId };
    expect(() => registry.sync([agent])).not.toThrow();
    expect(registry.get(agent).position).toEqual(PAYABLES);
    expect(registry.moving).toBe(false);
  });
});

describe("shared motion registry", () => {
  const alex = { id: "collections-clerk", pos: COLLECTIONS, targetAnchor: "collections" as AnchorId };

  it("returns one WalkMotion per agent so position persists across a view switch", () => {
    const registry = new MotionRegistry();
    registry.sync([alex]);
    const planView = registry.get(alex);
    registry.sync([{ ...alex, targetAnchor: "dana" }]);
    expect(planView.moving).toBe(true);
    for (let frame = 0; frame < 90; frame += 1) planView.advance(1 / 60);
    const midWalk = [...planView.position];
    expect(midWalk).not.toEqual(COLLECTIONS);

    // The 3D scene mounts and asks for the same agent: it must continue, not restart.
    const sceneView = registry.get({ ...alex, pos: COLLECTIONS });
    expect(sceneView).toBe(planView);
    expect(sceneView.position).toEqual(midWalk);
    registry.sync([{ ...alex, targetAnchor: "dana" }]);
    expect(sceneView.position).toEqual(midWalk);
    expect(sceneView.moving).toBe(true);
    for (let frame = 0; frame < 360; frame += 1) sceneView.advance(1 / 60);
    expect(sceneView.position).toEqual(DANA);
    expect(registry.moving).toBe(false);
  });

  it("creates motions as agents appear and disposes them when they leave", () => {
    const registry = new MotionRegistry();
    const sam = { id: "payables-clerk", pos: PAYABLES, targetAnchor: "payables" as AnchorId };
    registry.sync([alex, sam]);
    expect(registry.size).toBe(2);
    const first = registry.get(alex);
    registry.sync([sam]);
    expect(registry.has(alex.id)).toBe(false);
    expect(registry.size).toBe(1);
    registry.sync([alex, sam]);
    expect(registry.get(alex)).not.toBe(first);
  });

  it("re-seats the shared motion when a row's pos changes, then walks on to the target", () => {
    const registry = new MotionRegistry();
    registry.sync([{ ...alex, targetAnchor: "dana" }]);
    const walk = registry.get(alex);
    for (let frame = 0; frame < 30; frame += 1) walk.advance(1 / 60);
    registry.sync([{ ...alex, pos: [-6, CORRIDOR_Z], targetAnchor: "dana" }]);
    expect(registry.get(alex)).toBe(walk);
    expect(walk.position).toEqual([-6, CORRIDOR_Z]);
    expect(walk.moving).toBe(true);
    for (let frame = 0; frame < 360; frame += 1) walk.advance(1 / 60);
    expect(walk.position).toEqual(DANA);
  });

  it("pins recorded (replay) rows to agent.pos without walking", () => {
    const registry = new MotionRegistry();
    registry.sync([{ ...alex, targetAnchor: "dana" }], { recorded: true });
    const walk = registry.get(alex);
    expect(walk.position).toEqual(COLLECTIONS);
    expect(walk.moving).toBe(false);
    registry.sync([{ ...alex, pos: [-2, 0.6], targetAnchor: "dana" }], { recorded: true });
    expect(registry.get(alex)).toBe(walk);
    expect(walk.position).toEqual([-2, 0.6]);
    expect(walk.moving).toBe(false);
    expect(registry.moving).toBe(false);
  });
});

describe("registry wake-up and replay → live", () => {
  const alex = { id: "collections-clerk", pos: COLLECTIONS, targetAnchor: "collections" as AnchorId };

  it("reports when a sync changed what the views draw, so an on-demand renderer can request a frame", () => {
    const registry = new MotionRegistry();
    expect(registry.sync([alex])).toBe(true);
    expect(registry.sync([alex])).toBe(false);
    expect(registry.sync([{ ...alex, targetAnchor: "dana" }])).toBe(true);
    expect(registry.moving).toBe(true);
    expect(registry.sync([{ ...alex, targetAnchor: "dana" }])).toBe(false);
    expect(registry.sync([{ ...alex, pos: [-3, 0.6], targetAnchor: "dana" }])).toBe(true);
    expect(registry.sync([])).toBe(true);
  });

  it("walks every agent on to its target when replay hands over to live rows", () => {
    const registry = new MotionRegistry();
    registry.sync([{ ...alex, targetAnchor: "dana" }], { recorded: true });
    const walk = registry.get(alex);
    expect(walk.moving).toBe(false);
    expect(registry.sync([{ ...alex, targetAnchor: "dana" }], { recorded: true })).toBe(false);
    expect(registry.sync([{ ...alex, targetAnchor: "dana" }])).toBe(true);
    expect(walk.moving).toBe(true);
    expect(walk.position).toEqual(COLLECTIONS);
    for (let frame = 0; frame < 360; frame += 1) walk.advance(1 / 60);
    expect(walk.position).toEqual(DANA);
    // Staying live does not restart the walk.
    expect(registry.sync([{ ...alex, targetAnchor: "dana" }])).toBe(false);
  });
});
