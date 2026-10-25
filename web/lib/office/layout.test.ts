import { describe, expect, it } from 'vitest';
import { BUILDING, MAIN_BUILDING, WORKSTATIONS, ANCHOR_IDS, ROOM_SPAWNS, WALLS, WINDOWS, WALL_HEIGHT, sightBlocked, wallColliders, wallPieces, windowPieces, type Vec2 } from './layout';
import { EXTRA_WORKSTATIONS, deskPieces, deskScreenPiece, workstationPieces } from './furniture';
import { DESKS } from './targets/desk';
import { OFFICE_ANCHORS } from './state';
import { FLOOR, SPAWN, PLAYER_RADIUS, SERVER_ROOM_BOX, PAYLINK_KIOSK, insideAny, movePlayer, officeColliders } from './play';
import { HANDOFF_AGENTS, FLOOR_AGENTS, handoffRoute } from './handoffs';
import { roomEntry } from './overview';
import { TREES, BUSHES, groundClear } from './outdoors';
import { OFFICE_PROP_INTERACTIONS } from './props';
import { AUDIT_WALL } from './props/auditWall';
import { WHITEBOARD_INTERACTION } from './props/whiteboard';
import { ROLES } from './palette';

const colliders = officeColliders(ANCHOR_IDS, [SERVER_ROOM_BOX]);

/** Exercise the same swept collision movement as first person, at walking-size increments. */
function walk(from: Vec2, to: Vec2): Vec2 {
  let point = from;
  const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.05));
  const step: Vec2 = [(to[0] - from[0]) / steps, (to[1] - from[1]) / steps];
  for (let i = 0; i < steps; i++) {
    point = movePlayer(point, step, colliders);
    expect(insideAny(point, colliders, PLAYER_RADIUS), `${from} → ${to}: ${point}`).toBe(false);
  }
  expect(point[0]).toBeCloseTo(to[0], 5);
  expect(point[1]).toBeCloseTo(to[1], 5);
  return point;
}

describe('open office layout', () => {
  it('uses one compact room bounded only by four exterior walls', () => {
    expect(BUILDING).toEqual(MAIN_BUILDING);
    expect(WALLS).toHaveLength(4);
    expect(WALLS.every(wall => wall.exterior)).toBe(true);
    const full = wallPieces('full');
    expect(Math.max(...full.map(piece => piece.at[1] + piece.size[1] / 2))).toBe(WALL_HEIGHT);
    expect(full.every(piece => piece.size.every(size => size > 0))).toBe(true);
    expect(windowPieces().glass).toHaveLength(WINDOWS.length);
    expect(WINDOWS.every(window => WALLS.some(wall => wall.id === window.wall))).toBe(true);
  });

  it('has three 2 × 2 pods, exactly twelve desks, chairs and correctly facing screens', () => {
    expect(WORKSTATIONS).toHaveLength(12);
    expect(EXTRA_WORKSTATIONS).toHaveLength(8);
    for (const pod of [0, 1, 2]) {
      const seats = WORKSTATIONS.filter(seat => seat.pod === pod);
      expect(seats).toHaveLength(4);
      expect(new Set(seats.map(seat => seat.center[0])).size).toBe(2);
      expect(new Set(seats.map(seat => seat.center[1])).size).toBe(2);
      expect(seats.filter(seat => seat.flip === 1)).toHaveLength(2);
    }
    const pieces = [...DESKS.flatMap(deskPieces), ...EXTRA_WORKSTATIONS.flatMap(({ center, flip }) => workstationPieces(center, flip, ROLES.partition))];
    expect(pieces.filter(piece => piece.color === ROLES.desk && piece.size[0] === 2.25)).toHaveLength(12);
    expect(pieces.filter(piece => piece.size[0] === 0.65 && piece.size[1] === 0.65)).toHaveLength(12);
    expect(pieces.filter(piece => Math.abs(piece.size[0] - 1.9) < 1e-6)).toHaveLength(12);
    for (const room of DESKS) {
      const flip = room === 'dana' ? -1 : 1;
      const casing = deskPieces(room)[3]!;
      expect(deskScreenPiece(room).at[2] - casing.at[2]).toBeCloseTo(flip * 0.05);
    }
  });

  it('matches every workstation and chair to a real movement obstacle', () => {
    for (const { center: [x, z], flip } of WORKSTATIONS) {
      expect(insideAny([x, z], colliders, 0)).toBe(true);
      expect(insideAny([x + 0.05 * flip, z + 0.9 * flip], colliders, 0)).toBe(true);
    }
    // Removed leisure footprints and private partitions must not remain as invisible obstacles.
    for (const point of [[-18, -3.2], [8.6, 5.3], [9, -0.2], [-6, 2.5], [0, 2.5]] as Vec2[]) {
      if (point[0] >= FLOOR.minX) expect(insideAny(point, colliders, PLAYER_RADIUS)).toBe(false);
    }
  });

  it('keeps the entry, every teleport and useful spawn sightlines clear', () => {
    expect(insideAny(SPAWN.position, colliders, 1)).toBe(false);
    for (const spawn of Object.values(ROOM_SPAWNS)) {
      expect(insideAny(spawn.position, colliders, PLAYER_RADIUS), String(spawn.position)).toBe(false);
      expect(spawn.position[0]).toBeGreaterThan(FLOOR.minX);
      expect(spawn.position[0]).toBeLessThan(FLOOR.maxX);
    }
    for (const id of ANCHOR_IDS) {
      const entry = roomEntry(id, colliders);
      expect(insideAny(entry.position, colliders, PLAYER_RADIUS), id).toBe(false);
      expect(sightBlocked(...SPAWN.position, ...OFFICE_ANCHORS[id].position), id).toBe(false);
    }
  });

  it('walks from the entry through the full central aisle and around both sides of every pod', () => {
    walk(ROOM_SPAWNS.lobby.position, [-7.2, 0]);
    walk([-11, 0], [9, 0]);
    walk([9, 0], [-11, 0]);
    for (const podX of [-8, 0, 8]) {
      const side = podX - 3;
      walk([side, 0], [side, -6]);
      walk([side, -6], [podX + 1.2, -6]);
      walk([podX + 1.2, -6], [podX + 1.2, -5.3]);
    }
  });

  it('seats all seven roles at distinct pod workstations and walks every handoff route', () => {
    const stations = FLOOR_AGENTS.map(id => HANDOFF_AGENTS[id].station);
    expect(new Set(stations.map(String)).size).toBe(7);
    for (const station of stations) {
      expect(WORKSTATIONS.some(({ center: [x, z], flip }) => Math.hypot(station[0] - x, station[1] - z - flip * 1.6) < 1e-6)).toBe(true);
      expect(insideAny(station, colliders, PLAYER_RADIUS)).toBe(false);
    }
    for (const from of [...FLOOR_AGENTS, 'human' as const]) for (const to of [...FLOOR_AGENTS, 'human' as const]) {
      if (from === to) continue;
      const route = handoffRoute(from, to);
      for (let i = 1; i < route.length; i++) walk(route[i - 1]!, route[i]!);
    }
  });

  it('keeps foliage outdoors and away from the building, entry and workspace', () => {
    expect(TREES.length).toBeGreaterThan(40);
    for (const tree of TREES) expect(groundClear(tree.x, tree.z, tree.radius, 3.9)).toBe(true);
    for (const bush of BUSHES) expect(groundClear(bush.x, bush.z, bush.size * 0.5, 0.4)).toBe(true);
  });

  it('mounts evidence boards against solid exterior walls, with reachable approaches', () => {
    expect(Math.abs(AUDIT_WALL.x - BUILDING.minX)).toBeLessThan(0.2);
    expect(insideAny([AUDIT_WALL.x, AUDIT_WALL.z], wallColliders(), 0.15)).toBe(true);
    walk([-9, 5.3], [AUDIT_WALL.x + 0.9, AUDIT_WALL.z]);
    const [x, z] = WHITEBOARD_INTERACTION.position;
    walk([-5, -6], [x, -6]);
    walk([x, -6], [x, z]);
    walk([-7.2, 0], [PAYLINK_KIOSK[0], PAYLINK_KIOSK[1] - 1]);
    expect(OFFICE_PROP_INTERACTIONS.map(prop => prop.id)).not.toContain('clock');
  });
});
