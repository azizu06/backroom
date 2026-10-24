import { describe, expect, it } from "vitest";
import { WalkMotion } from "./motion";
import { createMockOfficeState } from "./state";

describe("office row → view contract", () => {
  it("publishes an immutable target change and stops notifying after unsubscribe", () => {
    const mock = createMockOfficeState();
    const initial = mock.source.getSnapshot();
    let notifications = 0;
    const unsubscribe = mock.source.subscribe(() => { notifications += 1; });
    mock.setTargetAnchor("dana");
    expect(notifications).toBe(1);
    expect(initial.agent.targetAnchor).toBe("collections");
    const changed = mock.source.getSnapshot();
    expect(changed.agent.targetAnchor).toBe("dana");
    expect(mock.source.getSnapshot()).toBe(changed);
    mock.setTargetAnchor("dana");
    expect(notifications).toBe(1);
    unsubscribe();
    mock.setTargetAnchor("collections");
    expect(notifications).toBe(1);
  });

  it("walks continuously through the aisle and reaches the requested desk", () => {
    const walk = new WalkMotion([-3, -1]);
    walk.moveTo("dana");
    expect(walk.position).toEqual([-3, -1]);
    let crossedAisle = false;
    for (let frame = 0; frame < 360; frame += 1) {
      const previous = [...walk.position];
      walk.advance(1 / 60);
      expect(Math.hypot(walk.position[0] - previous[0]!, walk.position[1] - previous[1]!)).toBeLessThanOrEqual(2.4 / 60 + 1e-6);
      if (Math.abs(walk.position[0]) < 1) {
        expect(walk.position[1]).toBeCloseTo(0.6);
        crossedAisle = true;
      }
    }
    expect(crossedAisle).toBe(true);
    expect(walk.position).toEqual([3, -1]);
    expect(walk.moving).toBe(false);
  });

  it("retargets mid-walk without resetting position and clamps a resumed frame", () => {
    const walk = new WalkMotion([-3, -1]);
    walk.moveTo("dana");
    for (let frame = 0; frame < 90; frame += 1) walk.advance(1 / 60);
    const before = [...walk.position];
    walk.moveTo("collections");
    expect(walk.position).toEqual(before);
    walk.advance(10);
    expect(Math.hypot(walk.position[0] - before[0]!, walk.position[1] - before[1]!)).toBeLessThanOrEqual(0.24 + 1e-6);
    for (let frame = 0; frame < 360; frame += 1) walk.advance(1 / 60);
    expect(walk.position).toEqual([-3, -1]);
  });
});
