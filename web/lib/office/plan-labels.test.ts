import { describe, expect, it } from 'vitest';
import { placePlanLabels, planRectsOverlap } from './plan-labels';
import { overviewMapAgents, overviewMapLayout } from './overview-map';
import { MotionRegistry } from './motion';
import { createMockOfficeState } from './preview';
import { OFFICE_ANCHORS, type AnchorId } from './state';
import { HANDOFF_AGENTS } from './handoffs';

describe('plan labels', () => {
  it('prefers the free side of a pod, falling back above when both sides are blocked', () => {
    const bounds = { x: 0, y: 0, width: 400, height: 300 };
    const pod = { x: 100, y: 120, width: 80, height: 60 };
    const label = { id: 'pod', anchor: { x: 140, y: 150 }, beside: pod, width: 80, height: 30 };
    expect(placePlanLabels([label], bounds, [pod])[0]!.x).toBe(184);
    const blockers = [pod, { x: 0, y: 120, width: 100, height: 60 }, { x: 180, y: 120, width: 220, height: 60 }];
    expect(placePlanLabels([label], bounds, blockers)[0]!.y).toBe(86);
  });

  it('does not emit an overlapping fallback if there is no free floor', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(placePlanLabels([{ id: 'full', anchor: { x: 50, y: 50 }, beside: bounds, width: 80, height: 30 }], bounds, [bounds])).toEqual([]);
  });

  for (const size of [280, 320, 342, 390, 479, 480, 600, 800]) {
    it(`places every real room clear of desks and other labels at ${size}px`, () => {
      const rooms = Object.keys(OFFICE_ANCHORS) as AnchorId[];
      const { labels, desks, server } = overviewMapLayout(size, size, rooms);
      expect(desks).toHaveLength(24);
      expect(labels).toHaveLength(rooms.length);
      for (const label of labels) {
        expect(label.x).toBeGreaterThanOrEqual(0);
        expect(label.y).toBeGreaterThanOrEqual(0);
        expect(label.x + label.width).toBeLessThanOrEqual(size);
        expect(label.y + label.height).toBeLessThanOrEqual(size);
        for (const other of [...desks, server, ...labels.filter(other => other !== label)]) {
          expect(planRectsOverlap(label, other), `${label.id} intersects ${JSON.stringify(other)}`).toBe(false);
        }
      }
    });
  }
});

describe('overview seat occupancy', () => {
  it('has exactly the subscribed agents, follows live motion, and removes departed agents', () => {
    const snapshot = createMockOfficeState().source.getSnapshot();
    const motions = new MotionRegistry();
    const agent = snapshot.agents[0]!;
    motions.get(agent).seat([2, 1]);
    const occupants = overviewMapAgents(snapshot, motions);
    expect(occupants.map(occupant => occupant.id)).toEqual(snapshot.agents.map(row => row.id));
    expect(occupants[0]!.position).toEqual([2, 1]);
    expect(occupants[0]!.seat).toBe(-1);
    expect(occupants[0]!.color).toBe(HANDOFF_AGENTS.collections.color);
    expect(overviewMapAgents({ ...snapshot, agents: [] }, motions)).toEqual([]);
    expect(overviewMapAgents({ ...snapshot, agents: [agent] }, motions)).toHaveLength(1);
  });

  it('only shows Dana when present, marks her human and tints her live seat', () => {
    const snapshot = createMockOfficeState().source.getSnapshot();
    const dana = { ...snapshot.agents[0]!, id: 'human', name: 'Dana', pos: HANDOFF_AGENTS.human.station };
    const [occupant] = overviewMapAgents({ ...snapshot, agents: [dana] }, new MotionRegistry());
    expect(occupant).toMatchObject({ id: 'human', human: true, color: HANDOFF_AGENTS.human.color, seat: 6 });
    expect(occupant!.position).toEqual(HANDOFF_AGENTS.human.station);
  });
});
