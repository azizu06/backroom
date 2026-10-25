/**
 * The office floor plan as data: the building shell, every space (rooms, the corridor and the server room),
 * their doorways, the outer windows and one spawn point per space. Pure (no three, no React) so Play's
 * colliders, the scene, the minimap and teleporting all read the same numbers.
 *
 * Coordinates are floor (x, z) in metres; +x is east, +z is south (toward the overview camera).
 * Two rows of four rooms sit either side of a 3 m east-west corridor (z = -1.5..1.5); the corridor's
 * east end is the GX10 server room. The lobby's street entrance is on the south wall.
 */
import type { FurniturePiece } from './furniture';
import { OUTDOOR, ROLES } from './palette';
import { CAMERA_CLEARANCE, CHAIR_FOOTPRINT, DESK_SIZE, STATION_OFFSET } from './metrics';

export type Vec2 = readonly [x: number, z: number];
export interface Rect { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }

/** One contiguous office; departments are logical destinations, never partitions. */
export const MAIN_BUILDING: Rect = { minX: -12, maxX: 12, minZ: -12, maxZ: 12 };
export const BUILDING: Rect = MAIN_BUILDING;
export const ATRIUM_HEIGHT = 7;
export const WALL_HEIGHT = 3.6;
export const WALL_THICKNESS = 0.16;
/** Top of every doorway; the wall above it is a header. */
export const DOOR_OPENING_HEIGHT = 2.25;
export const WINDOW_SILL = 0.9;
export const WINDOW_HEAD = 2.5;
/** Cross-aisle reference for the floor plan and minimap. */
export const CORRIDOR_Z = -1.2;

export const ANCHOR_IDS = ['lobby', 'collections', 'payables', 'vendor_onboarding', 'dana', 'treasury'] as const;
export type LayoutAnchorId = typeof ANCHOR_IDS[number];
export type SpaceId = LayoutAnchorId | 'meeting' | 'break_room' | 'server_room' | 'corridor' | 'work_room' | 'atrium';
/** Six four-seat pods: three columns, two rows; furniture remains at human scale. */
export const POD_COLUMNS = [-7.09, 0, 7.09] as const;
export const POD_ROWS = [-6, 3.6] as const;
const DESK_PITCH_X = DESK_SIZE.width + 0.15;
const DESK_PITCH_Z = DESK_SIZE.depth + 0.15;
export const WORKSTATIONS = POD_ROWS.flatMap((podZ, row) => POD_COLUMNS.flatMap((podX, column) =>
  [-1, 1].flatMap((side, seatColumn) => [-1, 1].map((flip, seatRow) => ({
    id: `pod-${row * POD_COLUMNS.length + column}:${seatColumn}:${seatRow}`,
    pod: row * POD_COLUMNS.length + column,
    center: [podX + side * DESK_PITCH_X / 2, podZ + flip * DESK_PITCH_Z / 2] as Vec2,
    flip: flip as 1 | -1,
  })))));

export function workstationApproach(index: number): Vec2 {
  const { center: [x, z], flip } = WORKSTATIONS[index]!;
  return [x, z + flip * STATION_OFFSET];
}
export const POD_BOUNDS: readonly Rect[] = POD_ROWS.flatMap(z => POD_COLUMNS.map(x => ({
  minX: x - DESK_PITCH_X / 2 - DESK_SIZE.width / 2, maxX: x + DESK_PITCH_X / 2 + DESK_SIZE.width / 2,
  minZ: z - DESK_PITCH_Z / 2 - CHAIR_FOOTPRINT.z - CHAIR_FOOTPRINT.depth / 2,
  maxZ: z + DESK_PITCH_Z / 2 + CHAIR_FOOTPRINT.z + CHAIR_FOOTPRINT.depth / 2,
})));
export const WORKSTATION_COLLIDERS: readonly Rect[] = WORKSTATIONS.flatMap(({ center: [x, z], flip }) => [
  fixtureBounds({ x, z, width: DESK_SIZE.width, depth: DESK_SIZE.depth }),
  fixtureBounds({ x: x + flip * CHAIR_FOOTPRINT.x, z: z + flip * CHAIR_FOOTPRINT.z,
    width: CHAIR_FOOTPRINT.width, depth: CHAIR_FOOTPRINT.depth }),
]);

/** All floor-standing perimeter props share footprints with navigation and collision. */
export const FLOOR_FIXTURES = {
  kiosk: { x: -11.3, z: 8.8, width: 0.8, depth: 1 },
  vault: { x: 8.5, z: 11.1, width: 1.84, depth: 1.42, offsetZ: -0.065 },
  server: { x: 11.3, z: -1.2, width: 1.2, depth: 1.05 },
  plantNW: { x: -11.3, z: -11.3, width: 1, depth: 1 },
  plantSE: { x: 11.3, z: 11.3, width: 1, depth: 1 },
  lampWest: { x: -11.4, z: 10.8, width: 0.6, depth: 0.6 },
  lampEast: { x: 11.4, z: 8.5, width: 0.6, depth: 0.6 },
} as const;
export function fixtureBounds(fixture: { x: number; z: number; width: number; depth: number; offsetZ?: number }): Rect {
  const z = fixture.z + (fixture.offsetZ ?? 0);
  return { minX: fixture.x - fixture.width / 2, maxX: fixture.x + fixture.width / 2,
    minZ: z - fixture.depth / 2, maxZ: z + fixture.depth / 2 };
}
export const GRID_AISLES = {
  x: [BUILDING.minX + 1.8, ...POD_COLUMNS.slice(1).map((x, i) => (x + POD_COLUMNS[i]!) / 2), BUILDING.maxX - 1.8],
  z: [BUILDING.minZ + 2.2, (POD_ROWS[0] + POD_ROWS[1]) / 2, BUILDING.maxZ - 3.4],
};

/** Rectilinear visibility graph: perimeter and cross-pod aisles, with clear endpoint approaches.
 * Inflated furniture footprints keep the camera 0.4 m clear, including on interrupted walks.
 * No diagonal shortcuts, so the player's axis sweeps can follow every segment exactly.
 */
export function workspaceRoute(from: Vec2, to: Vec2): Vec2[] {
  const obstacles = [...WORKSTATION_COLLIDERS, ...Object.values(FLOOR_FIXTURES).map(fixtureBounds)];
  const clear = (a: Vec2, b: Vec2) => !obstacles.some(rect =>
    Math.max(a[0], b[0]) > rect.minX - CAMERA_CLEARANCE && Math.min(a[0], b[0]) < rect.maxX + CAMERA_CLEARANCE &&
    Math.max(a[1], b[1]) > rect.minZ - CAMERA_CLEARANCE && Math.min(a[1], b[1]) < rect.maxZ + CAMERA_CLEARANCE);
  if (from[0] === to[0] && from[1] === to[1]) return [from];
  const xs = [...new Set([...GRID_AISLES.x, from[0], to[0]])].sort((a, b) => a - b);
  const zs = [...new Set([...GRID_AISLES.z, from[1], to[1]])].sort((a, b) => a - b);
  const nodes = xs.flatMap(x => zs.map(z => [x, z] as Vec2));
  const start = nodes.findIndex(p => p[0] === from[0] && p[1] === from[1]);
  const end = nodes.findIndex(p => p[0] === to[0] && p[1] === to[1]);
  const distance = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set<number>();
  distance[start] = 0;
  while (visited.size < nodes.length) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (current < 0 || distance[i]! < distance[current]!)) current = i;
    if (current < 0 || !Number.isFinite(distance[current])) break;
    if (current === end) {
      const route: Vec2[] = [];
      for (let i = end; i !== -1; i = previous[i]!) route.unshift(nodes[i]!);
      return route.filter((point, i) => i === 0 || i === route.length - 1 ||
        !((route[i - 1]![0] === point[0] && point[0] === route[i + 1]![0]) ||
          (route[i - 1]![1] === point[1] && point[1] === route[i + 1]![1])));
    }
    visited.add(current);
    for (let next = 0; next < nodes.length; next++) {
      const a = nodes[current]!, b = nodes[next]!;
      if (visited.has(next) || (a[0] !== b[0] && a[1] !== b[1]) || !clear(a, b)) continue;
      const cost = distance[current]! + Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
      if (cost < distance[next]!) { distance[next] = cost; previous[next] = current; }
    }
  }
  // An invalid/occupied destination cannot make an avatar or camera cross furniture.
  return [from];
}

// Conservative chair footprints end at z=5.425: 6.495 m to the inner south wall.
const ENTRY_POSITION: Vec2 = [0, 10.8];
const deskAnchor = (index: number) => ({ center: WORKSTATIONS[index]!.center, position: workstationApproach(index) });
export const ANCHOR_LAYOUT: Readonly<Record<LayoutAnchorId, { center: Vec2; position: Vec2 }>> = {
  lobby: { center: [FLOOR_FIXTURES.kiosk.x, FLOOR_FIXTURES.kiosk.z], position: [FLOOR_FIXTURES.kiosk.x + 1.5, FLOOR_FIXTURES.kiosk.z] },
  collections: deskAnchor(1),
  payables: deskAnchor(17),
  vendor_onboarding: deskAnchor(9),
  dana: deskAnchor(6),
  treasury: { center: [FLOOR_FIXTURES.vault.x, FLOOR_FIXTURES.vault.z - 0.6], position: [8.5, 9.5] },
};

/** Counter, notice board and live audit wall remain mounted on the perimeter. */
export const LOBBY_KIOSK: Vec2 = [FLOOR_FIXTURES.kiosk.x, FLOOR_FIXTURES.kiosk.z];
export const LOBBY_BOARD_MOUNT = { x: -10.7, y: 2.4, z: BUILDING.minZ + WALL_THICKNESS / 2 + 0.03,
  width: 2, height: 1.45, depth: 0.06, faceOffset: 0.038 } as const;
export const LOBBY_BOARD: Vec2 = [LOBBY_BOARD_MOUNT.x, LOBBY_BOARD_MOUNT.z];
export const LOBBY_AUDIT_WALL = { x: BUILDING.minX + WALL_THICKNESS / 2 + 0.03, z: 6.9, rotationY: Math.PI / 2 } as const;

/** A point given relative to an anchor room's furniture centre. */
export function roomPoint(room: LayoutAnchorId, dx: number, dz: number): [number, number] {
  const [x, z] = ANCHOR_LAYOUT[room].center;
  return [x + dx, z + dz];
}

export type DoorwayKind = 'leaf' | 'open' | 'locked' | 'entrance';
/** An opening in a wall. `axis` is the direction the wall runs: 'x' for a wall at fixed z, 'z' for one at fixed x. */
export interface Doorway {
  readonly id: string;
  readonly kind: DoorwayKind;
  readonly axis: 'x' | 'z';
  readonly at: Vec2;
  readonly width: number;
  readonly joins: readonly [SpaceId, SpaceId | 'outside'];
}
/** Leaf doorways leave room for the frame posts at centre ± 0.72 (see officeColliders). */
export const LEAF_OPENING = 1.44;
export const DOORWAYS: readonly Doorway[] = [
  // Compatibility interaction destinations; only the entrance cuts an exterior wall.
  ...ANCHOR_IDS.map(id => ({ id, kind: 'open' as const, axis: 'x' as const,
    at: id === 'treasury' ? [FLOOR_FIXTURES.vault.x, FLOOR_FIXTURES.vault.z - 0.65] as Vec2 : ANCHOR_LAYOUT[id].position,
    width: LEAF_OPENING, joins: [id, 'corridor'] as const })),
  { id: 'server_room', kind: 'open', axis: 'z', at: [9.8, FLOOR_FIXTURES.server.z], width: LEAF_OPENING, joins: ['server_room', 'corridor'] },
  { id: 'entrance', kind: 'entrance', axis: 'x', at: [0, BUILDING.maxZ], width: 1.6, joins: ['lobby', 'outside'] },
];
export function doorway(id: string): Doorway {
  const found = DOORWAYS.find(door => door.id === id);
  if (!found) throw new RangeError(`unknown doorway ${id}`);
  return found;
}

/** A straight wall. `fixed` is its z (axis 'x') or x (axis 'z'); it spans from..to along its axis. */
export interface WallRun {
  readonly id: string;
  readonly axis: 'x' | 'z';
  readonly fixed: number;
  readonly from: number;
  readonly to: number;
  readonly exterior: boolean;
  /** Cut-away height in the overview, so the floor plan stays readable from the orbit camera. */
  readonly overviewHeight: number;
  readonly height?: number;
}
const OUTER_FAR = 1.1, OUTER_NEAR = 0.35;
export const WALLS: readonly WallRun[] = [
  { id: 'north', axis: 'x', fixed: BUILDING.minZ, from: BUILDING.minX, to: BUILDING.maxX, exterior: true, overviewHeight: OUTER_FAR },
  { id: 'south', axis: 'x', fixed: BUILDING.maxZ, from: BUILDING.minX, to: BUILDING.maxX, exterior: true, overviewHeight: OUTER_NEAR },
  { id: 'west', axis: 'z', fixed: BUILDING.minX, from: BUILDING.minZ, to: BUILDING.maxZ, exterior: true, overviewHeight: OUTER_FAR },
  { id: 'east', axis: 'z', fixed: BUILDING.maxX, from: BUILDING.minZ, to: BUILDING.maxZ, exterior: true, overviewHeight: OUTER_NEAR },
];

/** A framed window in an exterior wall or the original west glazed partition, centred `at` along the wall. Placed clear of wall-mounted props. */
export interface WindowSpec { readonly wall: string; readonly at: number; readonly width: number; readonly space: SpaceId }
export const WINDOWS: readonly WindowSpec[] = [
  // Symmetric, evenly spaced bays; the central six metres stay solid for the ticket board.
  ...[-7.5, -4.5, 4.5, 7.5].map(at => ({ wall: 'north', at, width: 1.6, space: 'work_room' as const })),
  ...[-9, -5, -1, 3].map(at => ({ wall: 'west', at, width: 1.6, space: 'work_room' as const })),
  ...[-9, -5, 3, 7].map(at => ({ wall: 'east', at, width: 1.6, space: 'work_room' as const })),
  // Two equal bays either side of the entrance, clear of the vault at the southeast wall.
  ...[-6, -3, 3, 6].map(at => ({ wall: 'south', at, width: 1.6, space: 'lobby' as const })),
];

interface Opening { from: number; to: number; bottom: number; top: number }
function wallOf(id: string): WallRun {
  const found = WALLS.find(wall => wall.id === id);
  if (!found) throw new RangeError(`unknown wall ${id}`);
  return found;
}
const along = (wall: WallRun, point: Vec2) => wall.axis === 'x' ? point[0] : point[1];
const across = (wall: WallRun, point: Vec2) => wall.axis === 'x' ? point[1] : point[0];
/** Doorways (floor to DOOR_OPENING_HEIGHT) and, unless `doorsOnly`, windows (sill to head) on one wall, sorted. */
function openings(wall: WallRun, doorsOnly: boolean): Opening[] {
  const doors = DOORWAYS.filter(door => door.axis === wall.axis && Math.abs(across(wall, door.at) - wall.fixed) < 1e-6
    && along(wall, door.at) > wall.from && along(wall, door.at) < wall.to)
    .map(door => ({ from: along(wall, door.at) - door.width / 2, to: along(wall, door.at) + door.width / 2, bottom: 0, top: DOOR_OPENING_HEIGHT }));
  const windows = doorsOnly ? [] : WINDOWS.filter(win => win.wall === wall.id)
    .map(win => ({ from: win.at - win.width / 2, to: win.at + win.width / 2, bottom: WINDOW_SILL, top: WINDOW_HEAD }));
  return [...doors, ...windows].sort((a, b) => a.from - b.from);
}
/** A wall-aligned box from `from..to` along the wall and `bottom..top` in height. */
function wallBox(wall: WallRun, from: number, to: number, bottom: number, top: number, color: string): FurniturePiece {
  const mid = (from + to) / 2, length = to - from, height = top - bottom;
  return wall.axis === 'x'
    ? { at: [mid, bottom + height / 2, wall.fixed], size: [length, height, WALL_THICKNESS], color }
    : { at: [wall.fixed, bottom + height / 2, mid], size: [WALL_THICKNESS, height, length], color };
}

/**
 * Every wall as boxes. 'full' is the first-person building (full height, doorways and windows cut out);
 * 'overview' is the cut-away the orbit camera sees (low walls, doorways only).
 */
export function wallPieces(mode: 'full' | 'overview'): FurniturePiece[] {
  const pieces: FurniturePiece[] = [];
  for (const wall of WALLS) {
    const height = mode === 'full' ? (wall.height ?? WALL_HEIGHT) : wall.overviewHeight;
    const color = mode === 'overview' && !wall.exterior ? ROLES.partition : ROLES.wall;
    let cursor = wall.from;
    for (const gap of openings(wall, mode === 'overview')) {
      if (gap.from > cursor) pieces.push(wallBox(wall, cursor, gap.from, 0, height, color));
      if (gap.bottom > 0) pieces.push(wallBox(wall, gap.from, gap.to, 0, Math.min(gap.bottom, height), color));
      if (gap.top < height) pieces.push(wallBox(wall, gap.from, gap.to, gap.top, height, color));
      cursor = Math.max(cursor, gap.to);
    }
    if (cursor < wall.to) pieces.push(wallBox(wall, cursor, wall.to, 0, height, color));
  }
  return pieces;
}

/** Window frame width; frames reach this far past each opening's edges along the wall. */
export const WINDOW_FRAME = 0.07;
const FRAME = WINDOW_FRAME, FRAME_DEPTH = WALL_THICKNESS + 0.06;
/** Window frames (sill, head, jambs and a mullion) and the glass panes, one entry per window. */
export function windowPieces(): { frames: FurniturePiece[]; glass: FurniturePiece[] } {
  const frames: FurniturePiece[] = [], glass: FurniturePiece[] = [];
  for (const win of WINDOWS) {
    const wall = wallOf(win.wall);
    const from = win.at - win.width / 2, to = win.at + win.width / 2;
    const box = (a: number, b: number, bottom: number, top: number, depth: number, color: string): FurniturePiece => {
      const piece = wallBox(wall, a, b, bottom, top, color);
      const size: [number, number, number] = wall.axis === 'x' ? [piece.size[0], piece.size[1], depth] : [depth, piece.size[1], piece.size[2]];
      return { ...piece, size };
    };
    frames.push(
      box(from - FRAME, to + FRAME, WINDOW_SILL - FRAME, WINDOW_SILL, FRAME_DEPTH + 0.06, OUTDOOR.windowFrame),
      box(from - FRAME, to + FRAME, WINDOW_HEAD, WINDOW_HEAD + FRAME, FRAME_DEPTH, OUTDOOR.windowFrame),
      box(from - FRAME, from, WINDOW_SILL, WINDOW_HEAD, FRAME_DEPTH, OUTDOOR.windowFrame),
      box(to, to + FRAME, WINDOW_SILL, WINDOW_HEAD, FRAME_DEPTH, OUTDOOR.windowFrame),
      box(win.at - FRAME / 3, win.at + FRAME / 3, WINDOW_SILL, WINDOW_HEAD, FRAME_DEPTH * 0.6, OUTDOOR.windowFrame),
      box(from, to, (WINDOW_SILL + WINDOW_HEAD) / 2 + 0.25, (WINDOW_SILL + WINDOW_HEAD) / 2 + 0.25 + FRAME / 1.5, FRAME_DEPTH * 0.6, OUTDOOR.windowFrame),
    );
    glass.push(box(from, to, WINDOW_SILL, WINDOW_HEAD, 0.02, OUTDOOR.glass));
  }
  return { frames, glass };
}

/**
 * Solid footprints of the full-height walls: everything except doorway gaps. Locked doorways and the street
 * entrance are closed by a door-thick blocker, so the Treasury and the outside stay unreachable.
 */
export function wallColliders(): Rect[] {
  const boxes: Rect[] = [];
  const half = WALL_THICKNESS / 2;
  const rect = (wall: WallRun, from: number, to: number): Rect => wall.axis === 'x'
    ? { minX: from, maxX: to, minZ: wall.fixed - half, maxZ: wall.fixed + half }
    : { minX: wall.fixed - half, maxX: wall.fixed + half, minZ: from, maxZ: to };
  for (const wall of WALLS) {
    let cursor = wall.from;
    for (const gap of openings(wall, true)) {
      if (gap.from > cursor) boxes.push(rect(wall, cursor, gap.from));
      cursor = Math.max(cursor, gap.to);
    }
    if (cursor < wall.to) boxes.push(rect(wall, cursor, wall.to));
  }
  for (const door of DOORWAYS.filter(door => door.kind === 'locked' || door.kind === 'entrance')) {
    const [x, z] = door.at;
    boxes.push(door.axis === 'x'
      ? { minX: x - door.width / 2, maxX: x + door.width / 2, minZ: z - half, maxZ: z + half }
      : { minX: x - half, maxX: x + half, minZ: z - door.width / 2, maxZ: z + door.width / 2 });
  }
  return boxes;
}

/** wallColliders() flattened once as [minX, maxX, minZ, maxZ] per box, so sightBlocked allocates nothing per call. */
const SIGHT_WALLS: Float64Array = (() => {
  const boxes = wallColliders();
  const flat = new Float64Array(boxes.length * 4);
  boxes.forEach((box, i) => flat.set([box.minX, box.maxX, box.minZ, box.maxZ], i * 4));
  return flat;
})();
/**
 * True when a wall (or a locked door) stands between two floor points (ax, az) and (bx, bz), ignoring doorway
 * gaps. First-person views use it every frame to hide screen-space labels for things behind walls, so it takes
 * plain numbers and allocates nothing; it is a 2D test, so headers and window openings count as solid.
 */
export function sightBlocked(ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax, dz = bz - az;
  const flatX = Math.abs(dx) < 1e-12, flatZ = Math.abs(dz) < 1e-12;
  for (let i = 0; i < SIGHT_WALLS.length; i += 4) {
    const minX = SIGHT_WALLS[i]!, maxX = SIGHT_WALLS[i + 1]!, minZ = SIGHT_WALLS[i + 2]!, maxZ = SIGHT_WALLS[i + 3]!;
    let t0 = 0, t1 = 1;
    if (flatX) {
      if (ax < minX || ax > maxX) continue;
    } else {
      const a = (minX - ax) / dx, b = (maxX - ax) / dx;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
      if (t0 > t1) continue;
    }
    if (flatZ) {
      if (az < minZ || az > maxZ) continue;
    } else {
      const a = (minZ - az) / dz, b = (maxZ - az) / dz;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
      if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}

/** Logical map cells stay square even at a perimeter destination; they are not room walls. */
export function destinationRect(id: LayoutAnchorId): Rect {
  const half = 2.4, inset = WALL_THICKNESS / 2;
  const [x, z] = ANCHOR_LAYOUT[id].center;
  const cx = Math.max(BUILDING.minX + inset + half, Math.min(BUILDING.maxX - inset - half, x));
  const cz = Math.max(BUILDING.minZ + inset + half, Math.min(BUILDING.maxZ - inset - half, z));
  return { minX: cx - half, maxX: cx + half, minZ: cz - half, maxZ: cz + half };
}
/** Semantic destinations within one shared hall. */
export function spaceAt([x, z]: Vec2): SpaceId | null {
  const inside = (r: Rect) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
  if (!inside(BUILDING)) return null;
  if (inside(fixtureBounds(FLOOR_FIXTURES.server))) return 'server_room';
  return ANCHOR_IDS.filter(id => inside(destinationRect(id))).sort((a, b) =>
    Math.hypot(x - ANCHOR_LAYOUT[a].center[0], z - ANCHOR_LAYOUT[a].center[1]) -
    Math.hypot(x - ANCHOR_LAYOUT[b].center[0], z - ANCHOR_LAYOUT[b].center[1]))[0] ?? 'corridor';
}

/** Where a teleport lands: floor position and yaw (yaw 0 looks toward -z). `space` is where that point is. */
export interface RoomSpawn { readonly position: Vec2; readonly yaw: number; readonly space: SpaceId }
/**
 * Clear approaches to logical destinations. Legacy wing destinations return to the open office.
 */
const ENTRY_SPAWN: RoomSpawn = { position: ENTRY_POSITION, yaw: 0, space: 'lobby' };
export const ROOM_SPAWNS: Readonly<Record<SpaceId, RoomSpawn>> = {
  atrium: ENTRY_SPAWN, work_room: ENTRY_SPAWN, corridor: ENTRY_SPAWN, lobby: ENTRY_SPAWN,
  collections: { position: ANCHOR_LAYOUT.collections.position, yaw: 0, space: 'collections' },
  payables: { position: ANCHOR_LAYOUT.payables.position, yaw: 0, space: 'payables' },
  vendor_onboarding: { position: ANCHOR_LAYOUT.vendor_onboarding.position, yaw: 0, space: 'vendor_onboarding' },
  dana: { position: ANCHOR_LAYOUT.dana.position, yaw: Math.PI, space: 'dana' },
  treasury: { position: ANCHOR_LAYOUT.treasury.position, yaw: Math.PI, space: 'treasury' },
  meeting: { position: [0, 0], yaw: 0, space: 'work_room' },
  break_room: ENTRY_SPAWN,
  server_room: { position: [9.8, FLOOR_FIXTURES.server.z], yaw: -Math.PI / 2, space: 'server_room' },
};
