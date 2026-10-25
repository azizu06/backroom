import { describe, expect, it } from 'vitest';
import { AGENT_RADIUS, INTERACT_RANGE, PLAYER_RADIUS, forwardOf, insideAny, interactCandidates, officeColliders, pickTarget, type Vec2 } from './play';
import { AGENT_CLEARANCE, agentEntry, clearEntry, isOverviewKey, playOwnsMoveKeys, roomAtPoint, roomEntry, roomRect, seatedAgent, standable, yawToward } from './overview';
import { createMockOfficeState } from './preview';
import { OFFICE_ANCHORS, type AnchorId } from './state';

const ALL = Object.keys(OFFICE_ANCHORS) as AnchorId[];
const colliders = officeColliders(ALL);
const snapshot = createMockOfficeState().source.getSnapshot();

function facing(from: Vec2, yaw: number, to: Vec2): number {
  const [fx, fz] = forwardOf(yaw);
  const dx = to[0] - from[0], dz = to[1] - from[1];
  return Math.acos(Math.min(1, (dx * fx + dz * fz) / Math.hypot(dx, dz)));
}

describe('overview helpers', () => {
  it('yawToward uses the play camera convention (yaw 0 looks toward -z)', () => {
    expect(yawToward([0, 0], [0, -1])).toBeCloseTo(0);
    expect(facing([0, 0], yawToward([0, 0], [3, 2]), [3, 2])).toBeCloseTo(0);
  });
  it('maps points to square destination cells, including at the perimeter', () => {
    for (const room of ALL) {
      const rect = roomRect(room);
      expect(rect.maxX - rect.minX).toBeCloseTo(rect.maxZ - rect.minZ);
    }
    expect(roomAtPoint(OFFICE_ANCHORS.collections.center)).toBe('collections');
    expect(roomAtPoint(OFFICE_ANCHORS.dana.center)).toBe('dana');
    expect(roomAtPoint([0, 0.3])).toBeNull();
  });
  it('O toggles, unless a modifier is held', () => {
    expect(isOverviewKey({ key: 'o' })).toBe(true);
    expect(isOverviewKey({ key: 'O' })).toBe(true);
    expect(isOverviewKey({ key: 'o', ctrlKey: true })).toBe(false);
    expect(isOverviewKey({ key: 'p' })).toBe(false);
  });
  it('Play records movement keys only when neither story mode nor an Overview menu owns them', () => {
    expect(playOwnsMoveKeys({ story: false, menu: false })).toBe(true);
    expect(playOwnsMoveKeys({ story: true, menu: false })).toBe(false);
    expect(playOwnsMoveKeys({ story: false, menu: true })).toBe(false);
  });
  it('finds the agent seated at a desk', () => {
    expect(seatedAgent(snapshot, 'collections')).toBe('collections-clerk');
    expect(seatedAgent(snapshot, 'treasury')).toBeNull();
  });
});

describe('Go here next to an agent', () => {
  for (const agent of snapshot.agents) {
    it(`lands beside ${agent.name}, facing them, in their room, clear of colliders, with Talk offered`, () => {
      const entry = agentEntry(snapshot, agent.id, agent.pos, colliders, ALL)!;
      expect(entry).not.toBeNull();
      expect(insideAny(entry.position, colliders, PLAYER_RADIUS)).toBe(false);
      expect(standable(entry.position, colliders)).toBe(true);
      expect(roomAtPoint(entry.position)).toBe(roomAtPoint(agent.pos));
      const distance = Math.hypot(entry.position[0] - agent.pos[0], entry.position[1] - agent.pos[1]);
      expect(distance).toBeGreaterThan(0.6);
      expect(distance - AGENT_RADIUS).toBeLessThanOrEqual(INTERACT_RANGE);
      expect(facing(entry.position, entry.yaw, agent.pos)).toBeLessThan(1e-6);
      // The first-person pick (with every desk competing) offers this agent.
      const candidates = interactCandidates(snapshot.agents.map(row => ({ id: row.id, position: row.pos })), ALL);
      expect(pickTarget(entry.position, entry.yaw, candidates)).toEqual({ kind: 'agent', id: agent.id });
    });
  }
  it('works for an agent away from their desk (in the hallway)', () => {
    const agent = snapshot.agents[0]!;
    const entry = agentEntry(snapshot, agent.id, [0, 0.3], colliders, ALL)!;
    expect(standable(entry.position, colliders)).toBe(true);
    expect(facing(entry.position, entry.yaw, [0, 0.3])).toBeLessThan(1e-6);
  });
  it('returns null for an unknown agent', () => {
    expect(agentEntry(snapshot, 'nobody', [0, 0], colliders, ALL)).toBeNull();
  });
});

describe('jumping into a room', () => {
  for (const room of ALL) {
    it(`${room}: inside the room (Treasury: at its door), standable, clear of agents, facing the desk`, () => {
      const avoid = snapshot.agents.map(agent => agent.pos);
      const entry = roomEntry(room, colliders, avoid);
      expect(standable(entry.position, colliders)).toBe(true);
      for (const other of avoid) expect(Math.hypot(entry.position[0] - other[0], entry.position[1] - other[1])).toBeGreaterThanOrEqual(AGENT_CLEARANCE);
      if (room === 'treasury') expect(roomAtPoint(entry.position)).toBe('treasury');
      else {
        const rect = roomRect(room);
        expect(entry.position[0]).toBeGreaterThan(rect.minX);
        expect(entry.position[0]).toBeLessThan(rect.maxX);
        expect(entry.position[1]).toBeGreaterThan(rect.minZ);
        expect(entry.position[1]).toBeLessThan(rect.maxZ);
      }
      const { center } = OFFICE_ANCHORS[room];
      if (Math.hypot(center[0] - entry.position[0], center[1] - entry.position[1]) > 0.3) expect(facing(entry.position, entry.yaw, center)).toBeLessThan(1e-6);
    });
  }
});

describe('validating a live entry against rendered colliders', () => {
  it('keeps a clear requested pose unchanged', () => {
    const entry = { position: [0, 0] as const, yaw: 0.8 };
    expect(clearEntry(entry, [])).toBe(entry);
  });
  it('nudges to the nearest expanded edge and keeps facing the destination', () => {
    const boxes = [{ minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 }];
    const lookAt = [0, -1] as const;
    const entry = clearEntry({ position: [0.4, 0], yaw: 0, lookAt }, boxes)!;
    expect(entry.position).toEqual([0.5 + PLAYER_RADIUS, 0]);
    expect(insideAny(entry.position, boxes, PLAYER_RADIUS)).toBe(false);
    expect(facing(entry.position, entry.yaw, lookAt)).toBeCloseTo(0);
  });
  it('checks every collider when the nearest edge is blocked by another box', () => {
    const boxes = [
      { minX: -0.5, maxX: 0.5, minZ: -0.5, maxZ: 0.5 },
      { minX: 0.5, maxX: 2, minZ: -1, maxZ: 1 },
    ];
    const entry = clearEntry({ position: [0.4, 0], yaw: 0.8 }, boxes)!;
    expect(standable(entry.position, boxes)).toBe(true);
    expect(entry.position[0]).toBeCloseTo(0.5 - PLAYER_RADIUS);
    expect(Math.abs(entry.position[1])).toBeCloseTo(0.5 + PLAYER_RADIUS);
    expect(entry.yaw).toBe(0.8);
  });
  it('uses the nearest clear floor beyond 1.5 m when the nearby floor is blocked', () => {
    const boxes = [
      { minX: -3, maxX: 3, minZ: -3, maxZ: 3 },
    ];
    const lookAt = [0, 0] as const;
    const entry = clearEntry({ position: [0, 0], yaw: 0, lookAt }, boxes)!;
    expect(standable(entry.position, boxes)).toBe(true);
    expect(Math.hypot(...entry.position)).toBeCloseTo(3 + PLAYER_RADIUS);
    expect(facing(entry.position, entry.yaw, lookAt)).toBeCloseTo(0);
  });
});
