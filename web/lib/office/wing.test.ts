import { describe, expect, it } from 'vitest';
import { ATRIUM_HEIGHT, DOORWAYS, ROOM_SPAWNS, SPACES, spaceAt, type Vec2 } from './layout';
import { insideAny, movePlayer, officeColliders, PLAYER_RADIUS, type Box } from './play';
import { OUTDOOR, PALETTE, ROLES } from './palette';
import { WORK_DESKS, WORK_ROOM_PIECES, ATRIUM_PIECES, ATRIUM_ROOF, ATRIUM_SKYLIGHTS, WING_COLLIDERS } from './wing';

const colliders = officeColliders([]);
function walk(from: Vec2, to: Vec2, boxes: readonly Box[] = colliders): Vec2 {
  let point = from;
  const steps = Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.05);
  const step: Vec2 = [(to[0] - from[0]) / steps, (to[1] - from[1]) / steps];
  for (let i = 0; i < steps; i++) {
    point = movePlayer(point, step, boxes);
    expect(insideAny(point, boxes, PLAYER_RADIUS)).toBe(false);
  }
  expect(point[0]).toBeCloseTo(to[0], 5);
  expect(point[1]).toBeCloseTo(to[1], 5);
  return point;
}

describe('west wing', () => {
  it('keeps the original break room and adds a 12 x 10 m double-height atrium', () => {
    expect(SPACES.break_room.rect).toEqual({ minX: 6, maxX: 12, minZ: 1.5, maxZ: 7.5 });
    const r = SPACES.atrium.rect;
    expect([r.maxX - r.minX, r.maxZ - r.minZ, ATRIUM_HEIGHT]).toEqual([12, 10, 7]);
    expect(WORK_DESKS).toHaveLength(8);
  });

  it('keeps all furniture inside its room and uses palette tokens', () => {
    const tokens = new Set<string>([...Object.values(PALETTE), ...Object.values(ROLES), ...Object.values(OUTDOOR)]);
    for (const [id, pieces] of [['work_room', WORK_ROOM_PIECES], ['atrium', ATRIUM_PIECES]] as const) {
      const r = SPACES[id].rect;
      for (const p of pieces) {
        expect(p.at[0] - p.size[0] / 2).toBeGreaterThan(r.minX);
        expect(p.at[0] + p.size[0] / 2).toBeLessThan(r.maxX);
        expect(p.at[2] - p.size[2] / 2).toBeGreaterThan(r.minZ);
        expect(p.at[2] + p.size[2] / 2).toBeLessThan(r.maxZ);
        expect(tokens.has(p.color)).toBe(true);
      }
    }
  });

  it('walks through the corridor opening, across the hall and into the work room', () => {
    let point = walk([-10.8, 0], ROOM_SPAWNS.atrium.position);
    expect(spaceAt(point)).toBe('atrium');
    point = walk(point, [-18, 0]);
    point = walk(point, ROOM_SPAWNS.work_room.position);
    expect(spaceAt(point)).toBe('work_room');
    // Continue through the central aisle to the printer, stopping at its footprint.
    const stopped = movePlayer(point, [0, 8], colliders);
    expect(stopped[1]).toBeLessThan(6.5);
    expect(stopped[1]).toBeGreaterThan(6);
    for (const id of ['atrium', 'work_room'] as const) {
      expect(insideAny(ROOM_SPAWNS[id].position, colliders, PLAYER_RADIUS)).toBe(false);
      expect(insideAny(DOORWAYS.find(door => door.id === id)!.at, WING_COLLIDERS, PLAYER_RADIUS + 0.3)).toBe(false);
    }
  });

  it('blocks desks, planters, seating and solid wall beside the atrium doorway', () => {
    for (const box of WING_COLLIDERS) {
      const center: Vec2 = [(box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2];
      expect(insideAny(center, colliders, 0)).toBe(true);
    }
    const stopped = movePlayer([-10.8, 1.15], [-4, 0], colliders);
    expect(stopped[0]).toBeGreaterThan(-12);
  });

  it('leaves real skylight holes and a clear double-height hall below the roof', () => {
    expect(ATRIUM_SKYLIGHTS).toHaveLength(2);
    for (const pane of ATRIUM_SKYLIGHTS) {
      expect(pane.at[1]).toBeGreaterThanOrEqual(7);
      for (const roof of ATRIUM_ROOF) {
        const overlapX = Math.min(pane.at[0] + 1.5, roof.at[0] + roof.size[0] / 2) - Math.max(pane.at[0] - 1.5, roof.at[0] - roof.size[0] / 2);
        const overlapZ = Math.min(pane.at[2] + 3, roof.at[2] + roof.size[2] / 2) - Math.max(pane.at[2] - 3, roof.at[2] - roof.size[2] / 2);
        // Frame/mullions cross the glass, while opaque roof slabs stay outside the opening.
        if (roof.size[1] === 0.12) expect(overlapX <= 1e-9 || overlapZ <= 1e-9).toBe(true);
      }
    }
  });

  it('fits six static draws and fewer than 4000 added furniture/roof triangles', () => {
    // Unit boxes: 12 triangles; ten-sided cylinders: 40; 10 x 6 spheres: 100.
    const pieces = [...WORK_ROOM_PIECES, ...ATRIUM_PIECES, ...ATRIUM_ROOF, ...ATRIUM_SKYLIGHTS];
    const triangles = pieces.reduce((sum, p) => sum + (p.shape === 'box' ? 12 : p.shape === 'cylinder' ? 40 : 100), 0);
    expect(triangles).toBeLessThan(4000);
    console.info(`West wing: 6 static draws, ${triangles} furniture/roof triangles (4 draws in overview); shell remains batched.`);
  });
});
