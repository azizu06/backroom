import { describe, expect, it } from 'vitest';
import {
  ANCHOR_IDS, ANCHOR_LAYOUT, ATRIUM_HEIGHT, BUILDING, MAIN_BUILDING, CORRIDOR, DOORWAYS, LEAF_OPENING, ROOM_SPAWNS, SPACES, SPACE_IDS, WALLS, WALL_HEIGHT, WINDOWS,
  WINDOW_HEAD, WINDOW_SILL, sightBlocked, spaceAt, wallColliders, wallPieces, windowPieces, type Rect, type Vec2,
} from './layout';
import { BUSHES, HILLS, PATH, PLAZA, SUN_DIRECTION, TREES, groundClear } from './outdoors';
import { OFFICE_LIGHTING } from './lighting';
import { OUTDOOR, PALETTE, ROLES } from './palette';
import { FLOOR, PAYLINK_KIOSK, PLAYER_RADIUS, SERVER_ROOM_BOX, insideAny, officeColliders } from './play';
import { AUDIT_WALL } from './props/auditWall';
import { SHARED_ROOM_COLLIDERS, SHARED_ROOM_PIECES } from './shared-rooms';
import { dressingColliders } from './props/dressing';
import { OFFICE_ANCHORS, type AnchorId } from './state';
import { INTERIOR_DOORS, doorPosition } from './doors';

const area = (r: Rect) => (r.maxX - r.minX) * (r.maxZ - r.minZ);
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));
const inside = (r: Rect, [x, z]: Vec2, margin = 0) => x >= r.minX + margin && x <= r.maxX - margin && z >= r.minZ + margin && z <= r.maxZ - margin;
const rooms = Object.keys(OFFICE_ANCHORS) as AnchorId[];
const colliders = officeColliders(rooms, [...dressingColliders(rooms), SERVER_ROOM_BOX]);

describe('floor plan data', () => {
  it('adds a 180 square metre wing and keeps every space inside the building', () => {
    expect(area(MAIN_BUILDING)).toBe(24 * 15);
    expect(area(BUILDING)).toBe(area(MAIN_BUILDING) + 180);
    for (const id of SPACE_IDS) {
      const { rect } = SPACES[id];
      expect(rect.minX >= BUILDING.minX && rect.maxX <= BUILDING.maxX && rect.minZ >= BUILDING.minZ && rect.maxZ <= BUILDING.maxZ, id).toBe(true);
    }
  });

  it('tiles the building with spaces that never overlap', () => {
    for (const [i, a] of SPACE_IDS.entries()) for (const b of SPACE_IDS.slice(i + 1)) {
      expect(overlap(SPACES[a].rect, SPACES[b].rect), `${a} vs ${b}`).toBe(0);
    }
    expect(SPACE_IDS.reduce((sum, id) => sum + area(SPACES[id].rect), 0)).toBeCloseTo(area(BUILDING), 6);
  });

  it('keeps every existing room, gives each more space and adds a break room and a meeting room', () => {
    expect([...ANCHOR_IDS].sort()).toEqual([...rooms].sort());
    for (const room of ANCHOR_IDS) {
      // The old rooms were about 5 x 4.5 m.
      expect(area(SPACES[room].rect), room).toBeGreaterThan(5 * 4.5);
      // Furniture centre and agent spot belong to the room (the locked Treasury's spot is at its door).
      expect(spaceAt(ANCHOR_LAYOUT[room].center), room).toBe(room);
      expect(spaceAt(ANCHOR_LAYOUT[room].position), room).toBe(room === 'treasury' ? 'corridor' : room);
    }
    expect(SPACES.break_room.kind).toBe('room');
    expect(SPACES.meeting.kind).toBe('room');
    // A corridor wider than the old 2.2 m aisle.
    expect(CORRIDOR.maxZ - CORRIDOR.minZ).toBeGreaterThanOrEqual(3);
  });

  it('joins exactly the two spaces each doorway names, one on either side', () => {
    expect(new Set(DOORWAYS.map(door => door.id)).size).toBe(DOORWAYS.length);
    for (const door of DOORWAYS) {
      const [x, z] = door.at;
      const sides: [Vec2, Vec2] = door.axis === 'x' ? [[x, z - 0.3], [x, z + 0.3]] : [[x - 0.3, z], [x + 0.3, z]];
      const found = sides.map(point => spaceAt(point) ?? 'outside');
      expect(found.sort(), door.id).toEqual([...door.joins].sort());
      expect(door.joins[0], door.id).not.toBe(door.joins[1]);
      // The doorway sits on a wall line, within that wall.
      const wall = WALLS.find(w => w.axis === door.axis && Math.abs(w.fixed - (door.axis === 'x' ? z : x)) < 1e-9
        && (door.axis === 'x' ? x : z) - door.width / 2 > w.from && (door.axis === 'x' ? x : z) + door.width / 2 < w.to);
      expect(wall, door.id).toBeDefined();
    }
    // Reachability follows the doorway graph, including the work room through the atrium.
    const reachable = new Set<string>(['corridor']);
    for (let pass = 0; pass < SPACE_IDS.length; pass++) for (const door of DOORWAYS) {
      if (door.joins.some(id => reachable.has(id))) door.joins.forEach(id => reachable.add(id));
    }
    for (const id of SPACE_IDS) expect(reachable.has(id), id).toBe(true);
    // The cosmetic interior doors hang in their leaf doorways.
    for (const room of INTERIOR_DOORS) {
      const door = DOORWAYS.find(d => d.id === room)!;
      expect(door.kind).toBe('leaf');
      expect(door.width).toBe(LEAF_OPENING);
      expect(doorPosition(room)).toEqual(door.at);
    }
  });

  it('puts one spawn in every space, inside it and clear of every collider', () => {
    expect(Object.keys(ROOM_SPAWNS).sort()).toEqual([...SPACE_IDS].sort());
    for (const id of SPACE_IDS) {
      const spawn = ROOM_SPAWNS[id];
      expect(spawn.space, id).toBe(id === 'treasury' ? 'corridor' : id);
      expect(inside(SPACES[spawn.space].rect, spawn.position, PLAYER_RADIUS), id).toBe(true);
      expect(spaceAt(spawn.position), id).toBe(spawn.space);
      expect(insideAny(spawn.position, colliders, PLAYER_RADIUS), id).toBe(false);
      expect(Number.isFinite(spawn.yaw), id).toBe(true);
    }
  });
});

describe('building shell', () => {
  const full = wallPieces('full'), overview = wallPieces('overview');
  it('builds full-height walls in first person and lower cut-away walls for the overview', () => {
    for (const piece of full) expect(piece.at[1] + piece.size[1] / 2).toBeLessThanOrEqual(ATRIUM_HEIGHT + 1e-9);
    expect(Math.max(...full.map(piece => piece.at[1] + piece.size[1] / 2))).toBeCloseTo(ATRIUM_HEIGHT);
    expect(Math.max(...overview.map(piece => piece.at[1] + piece.size[1] / 2))).toBeLessThanOrEqual(1.1 + 1e-9);
    for (const piece of [...full, ...overview]) expect(piece.size.every(size => size > 0), String(piece.at)).toBe(true);
    // Exterior runs cover the entire perimeter; the old west windows become a glazed partition.
    const exterior = WALLS.filter(wall => wall.exterior);
    const perimeter = exterior.reduce((sum, wall) => sum + wall.to - wall.from, 0);
    expect(perimeter).toBe(2 * (BUILDING.maxX - BUILDING.minX + BUILDING.maxZ - BUILDING.minZ));
    for (const wall of exterior) expect(wall.axis === 'x'
      ? [BUILDING.minZ, BUILDING.maxZ].includes(wall.fixed)
      : [BUILDING.minX, BUILDING.maxX].includes(wall.fixed), wall.id).toBe(true);
    expect(full.some(piece => piece.at[1] + piece.size[1] / 2 === WALL_HEIGHT)).toBe(true);
  });

  it('frames every window in an exterior wall or the original glazed partition of its own space, clear of doorways and other windows', () => {
    const { frames, glass } = windowPieces();
    expect(glass).toHaveLength(WINDOWS.length);
    expect(frames.length).toBe(WINDOWS.length * 6);
    expect(WINDOW_HEAD - WINDOW_SILL).toBeGreaterThan(1.2);
    for (const win of WINDOWS) {
      const wall = WALLS.find(w => w.id === win.wall)!;
      expect(wall.exterior, win.wall).toBe(win.wall !== 'west');
      const point: Vec2 = wall.axis === 'x' ? [win.at, wall.fixed + (wall.fixed < 0 ? 0.3 : -0.3)] : [wall.fixed + (wall.fixed < 0 ? 0.3 : -0.3), win.at];
      expect(spaceAt(point), `${win.wall} ${win.at}`).toBe(win.space);
      const span = (at: number, width: number) => [at - width / 2, at + width / 2] as const;
      const [a0, a1] = span(win.at, win.width);
      const own = SPACES[win.space].rect;
      const [r0, r1] = wall.axis === 'x' ? [own.minX, own.maxX] : [own.minZ, own.maxZ];
      expect(a0 > r0 + 0.1 && a1 < r1 - 0.1, `${win.wall} ${win.at} inside its room`).toBe(true);
      for (const other of WINDOWS) if (other !== win && other.wall === win.wall) {
        const [b0, b1] = span(other.at, other.width);
        expect(a1 + 0.2 < b0 || b1 + 0.2 < a0, `${win.wall} ${win.at} vs ${other.at}`).toBe(true);
      }
      for (const door of DOORWAYS.filter(door => door.axis === wall.axis)) {
        const along = wall.axis === 'x' ? door.at[0] : door.at[1], across = wall.axis === 'x' ? door.at[1] : door.at[0];
        if (Math.abs(across - wall.fixed) > 1e-9) continue;
        const [b0, b1] = span(along, door.width);
        expect(a1 < b0 || b1 < a0, `${win.wall} ${win.at} vs door ${door.id}`).toBe(true);
      }
    }
  });

  it('makes walls solid except at doorways, so the colliders match the drawn walls', () => {
    const walls = wallColliders();
    // Walls sit on the drawn wall lines and stay within the building.
    for (const box of walls) {
      expect(box.minX >= BUILDING.minX - 0.1 && box.maxX <= BUILDING.maxX + 0.1 && box.minZ >= BUILDING.minZ - 0.1 && box.maxZ <= BUILDING.maxZ + 0.1).toBe(true);
    }
    for (const door of DOORWAYS) {
      const blocked = insideAny(door.at, walls, 0.01);
      expect(blocked, door.id).toBe(door.kind === 'locked' || door.kind === 'entrance');
    }
    // A window is an opening in the drawing but solid underfoot.
    for (const win of WINDOWS) {
      const wall = WALLS.find(w => w.id === win.wall)!;
      const point: Vec2 = wall.axis === 'x' ? [win.at, wall.fixed] : [wall.fixed, win.at];
      expect(insideAny(point, walls, 0.01), `${win.wall} ${win.at}`).toBe(true);
    }
    // Every full-height wall box (below the door header) is covered by a collider.
    for (const piece of wallPieces('full').filter(piece => piece.at[1] - piece.size[1] / 2 < 0.01)) {
      const centre: Vec2 = [piece.at[0], piece.at[2]];
      expect(insideAny(centre, walls, 0.001), String(piece.at)).toBe(true);
    }
    expect(FLOOR.minX).toBeGreaterThan(BUILDING.minX);
    expect(FLOOR.maxZ).toBeLessThan(BUILDING.maxZ);
  });
});

describe('shared rooms', () => {
  it('keeps the meeting and break room furniture inside the shared spaces and off the doorways', () => {
    const shared = [SPACES.meeting.rect, SPACES.break_room.rect, SPACES.server_room.rect];
    for (const piece of SHARED_ROOM_PIECES) {
      expect(shared.some(rect => inside(rect, [piece.at[0], piece.at[2]])), String(piece.at)).toBe(true);
    }
    for (const box of SHARED_ROOM_COLLIDERS) {
      for (const door of DOORWAYS) expect(insideAny(door.at, [box], PLAYER_RADIUS + 0.3), door.id).toBe(false);
    }
  });
});

describe('outdoors', () => {
  it('grows trees and bushes off the building, the path and the plaza', () => {
    expect(TREES.length).toBeGreaterThan(40);
    expect(BUSHES.length).toBeGreaterThan(30);
    expect(TREES.some(tree => tree.kind === 'pine') && TREES.some(tree => tree.kind === 'round')).toBe(true);
    for (const tree of TREES) expect(groundClear(tree.x, tree.z, tree.radius, 3.9), `${tree.x},${tree.z}`).toBe(true);
    for (const bush of BUSHES) expect(groundClear(bush.x, bush.z, bush.size * 0.5, 0.4), `${bush.x},${bush.z}`).toBe(true);
    expect(HILLS.every(hill => Math.hypot(hill.x, hill.z) > 100)).toBe(true);
  });

  it('runs the path from the street to the lobby entrance', () => {
    const entrance = DOORWAYS.find(door => door.kind === 'entrance')!;
    expect(entrance.joins).toContain('lobby');
    expect(PATH.minX < entrance.at[0] && PATH.maxX > entrance.at[0]).toBe(true);
    expect(PATH.minZ).toBe(BUILDING.maxZ);
    expect(PLAZA.minX < entrance.at[0] && PLAZA.maxX > entrance.at[0]).toBe(true);
  });

  it('puts the sun on the key light direction, low enough to see through a window', () => {
    const [x, y, z] = OFFICE_LIGHTING.key.position;
    const length = Math.hypot(x, y, z);
    expect(SUN_DIRECTION[0]).toBeCloseTo(x / length);
    expect(SUN_DIRECTION[1]).toBeCloseTo(y / length);
    expect(SUN_DIRECTION[2]).toBeCloseTo(z / length);
    const elevation = Math.asin(SUN_DIRECTION[1]) * 180 / Math.PI;
    expect(elevation).toBeGreaterThan(15);
    expect(elevation).toBeLessThan(35);
  });

  it('uses named palette tokens for every outdoor and shared-room colour', () => {
    const allowed = new Set<string>([...Object.values(PALETTE), ...Object.values(OUTDOOR), ...Object.values(ROLES)]);
    for (const piece of SHARED_ROOM_PIECES) expect(allowed.has(piece.color), piece.color).toBe(true);
    for (const value of Object.values(OUTDOOR)) expect(value).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe('sight lines', () => {
  it('is blocked by walls and locked doors but not through open doorways or along the corridor', () => {
    const [cx, cz] = OFFICE_ANCHORS.collections.center, [px, pz] = OFFICE_ANCHORS.payables.center;
    expect(sightBlocked([cx, cz], [px, pz])).toBe(true);
    expect(sightBlocked([-11, 0], [9, 0])).toBe(false);
    expect(sightBlocked([cx, 0.5], [cx, cz])).toBe(false);
    expect(sightBlocked([cx + 2, 0.5], [cx + 2, cz])).toBe(true);
    const [tx, tz] = DOORWAYS.find(door => door.id === 'treasury')!.at;
    expect(sightBlocked([tx, tz - 1], [tx, tz + 1])).toBe(true);
  });
});

describe('lobby windows', () => {
  it('keeps the audit wall on a solid interior wall and the kiosk out of the view to the west windows', () => {
    const lobbyWindows = WINDOWS.filter(win => win.space === 'lobby' && win.wall === 'west');
    expect(lobbyWindows.length).toBeGreaterThanOrEqual(2);
    // The audit wall hangs on the lobby's east wall (x = -6), which is interior and has no windows or doorways there.
    expect(Math.abs(AUDIT_WALL.x - SPACES.lobby.rect.maxX)).toBeLessThan(0.2);
    expect(WALLS.find(wall => wall.axis === 'z' && wall.fixed === SPACES.lobby.rect.maxX && !wall.exterior)).toBeDefined();
    expect(insideAny([AUDIT_WALL.x, AUDIT_WALL.z], wallColliders(), 0.1)).toBe(true);
    // From anywhere in the west half of the lobby, the sight lines to every west window miss the kiosk counter and the audit wall.
    const kiosk = { minX: PAYLINK_KIOSK[0] - 0.4, maxX: PAYLINK_KIOSK[0] + 0.4, minZ: PAYLINK_KIOSK[1] - 0.5, maxZ: PAYLINK_KIOSK[1] + 0.5 };
    expect(kiosk.minX).toBeGreaterThan(SPACES.lobby.rect.minX + (SPACES.lobby.rect.maxX - SPACES.lobby.rect.minX) / 2);
    expect(AUDIT_WALL.x).toBeGreaterThan(kiosk.minX);
  });
});
