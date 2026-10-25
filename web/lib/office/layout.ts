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

export type Vec2 = readonly [x: number, z: number];
export interface Rect { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }

export const BUILDING: Rect = { minX: -12, maxX: 12, minZ: -7.5, maxZ: 7.5 };
export const WALL_HEIGHT = 3;
export const WALL_THICKNESS = 0.16;
/** Top of every doorway; the wall above it is a header. */
export const DOOR_OPENING_HEIGHT = 2.25;
export const WINDOW_SILL = 0.9;
export const WINDOW_HEAD = 2.5;
/** Centre line of the corridor; agents and painted routes walk along it. */
export const CORRIDOR_Z = 0;
export const CORRIDOR: Rect = { minX: BUILDING.minX, maxX: 9.5, minZ: -1.5, maxZ: 1.5 };

export const ANCHOR_IDS = ['lobby', 'collections', 'payables', 'vendor_onboarding', 'dana', 'treasury'] as const;
export type LayoutAnchorId = typeof ANCHOR_IDS[number];
export type SpaceId = LayoutAnchorId | 'meeting' | 'break_room' | 'server_room' | 'corridor';
export interface Space { readonly id: SpaceId; readonly name: string; readonly rect: Rect; readonly kind: 'room' | 'corridor' }

const NORTH = { minZ: BUILDING.minZ, maxZ: CORRIDOR.minZ } as const;
const SOUTH = { minZ: CORRIDOR.maxZ, maxZ: BUILDING.maxZ } as const;
const COLUMNS = [[-12, -6], [-6, 0], [0, 6], [6, 12]] as const;
const column = (i: 0 | 1 | 2 | 3) => ({ minX: COLUMNS[i][0], maxX: COLUMNS[i][1] });
const room = (id: SpaceId, name: string, rect: Rect): Space => ({ id, name, rect, kind: 'room' });

export const SPACES: Readonly<Record<SpaceId, Space>> = {
  collections: room('collections', 'Collections', { ...column(0), ...NORTH }),
  payables: room('payables', 'Payables', { ...column(1), ...NORTH }),
  vendor_onboarding: room('vendor_onboarding', 'Vendor Desk', { ...column(2), ...NORTH }),
  meeting: room('meeting', 'Meeting room', { ...column(3), ...NORTH }),
  lobby: room('lobby', 'Lobby', { ...column(0), ...SOUTH }),
  dana: room('dana', 'Dana’s desk', { ...column(1), ...SOUTH }),
  treasury: room('treasury', 'Treasury', { ...column(2), ...SOUTH }),
  break_room: room('break_room', 'Break room', { ...column(3), ...SOUTH }),
  corridor: { id: 'corridor', name: 'Corridor', rect: CORRIDOR, kind: 'corridor' },
  server_room: room('server_room', 'Server room', { minX: CORRIDOR.maxX, maxX: BUILDING.maxX, minZ: CORRIDOR.minZ, maxZ: CORRIDOR.maxZ }),
};
export const SPACE_IDS = Object.keys(SPACES) as SpaceId[];

/**
 * Each anchor room's furniture centre (`center`: the desk, counter or vault) and the agent spot in front of it
 * (`position`). The Treasury is locked, so its agent spot is on the corridor side of its door.
 */
export const ANCHOR_LAYOUT: Readonly<Record<LayoutAnchorId, { center: Vec2; position: Vec2 }>> = {
  lobby: { center: [-9, 4.4], position: [-9, 4.5] },
  collections: { center: [-9, -5], position: [-9, -3.8] },
  payables: { center: [-3.5, -5], position: [-3.5, -3.8] },
  vendor_onboarding: { center: [2.5, -5], position: [2.5, -3.8] },
  dana: { center: [-3.5, 4.9], position: [-3.5, 3.7] },
  treasury: { center: [2.5, 4.9], position: [2.5, 0.95] },
};

/**
 * The lobby's pay kiosk counter (Play payment-link target, inbox and receipt printer). It stands by the lobby's
 * east wall so the view from the lobby out of its west windows stays clear.
 */
export const LOBBY_KIOSK: Vec2 = [-7, 3.4];
/** The live audit wall hangs on the lobby's solid east wall (an interior wall, no windows), facing west into the lobby. */
/** The lobby's decision board (last three decisions and the deny stamp) stands against the corridor wall east of the lobby opening, facing into the lobby. */
export const LOBBY_BOARD: Vec2 = [-7, CORRIDOR.maxZ + WALL_THICKNESS / 2 + 0.1];
export const LOBBY_AUDIT_WALL = { x: -6 - WALL_THICKNESS / 2 - 0.03, z: 5.3, rotationY: -Math.PI / 2 } as const;

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
  { id: 'collections', kind: 'leaf', axis: 'x', at: [-9, CORRIDOR.minZ], width: LEAF_OPENING, joins: ['collections', 'corridor'] },
  { id: 'payables', kind: 'leaf', axis: 'x', at: [-3.5, CORRIDOR.minZ], width: LEAF_OPENING, joins: ['payables', 'corridor'] },
  { id: 'vendor_onboarding', kind: 'leaf', axis: 'x', at: [2.5, CORRIDOR.minZ], width: LEAF_OPENING, joins: ['vendor_onboarding', 'corridor'] },
  { id: 'meeting', kind: 'open', axis: 'x', at: [8, CORRIDOR.minZ], width: 1.6, joins: ['meeting', 'corridor'] },
  { id: 'lobby', kind: 'open', axis: 'x', at: [-9, CORRIDOR.maxZ], width: 2, joins: ['lobby', 'corridor'] },
  { id: 'dana', kind: 'open', axis: 'x', at: [-3.5, CORRIDOR.maxZ], width: 1.6, joins: ['dana', 'corridor'] },
  { id: 'treasury', kind: 'locked', axis: 'x', at: [2.5, CORRIDOR.maxZ], width: LEAF_OPENING, joins: ['treasury', 'corridor'] },
  { id: 'break_room', kind: 'open', axis: 'x', at: [8, CORRIDOR.maxZ], width: 1.6, joins: ['break_room', 'corridor'] },
  { id: 'server_room', kind: 'open', axis: 'z', at: [CORRIDOR.maxX, 0], width: LEAF_OPENING, joins: ['server_room', 'corridor'] },
  { id: 'entrance', kind: 'entrance', axis: 'x', at: [-7.2, BUILDING.maxZ], width: 1.6, joins: ['lobby', 'outside'] },
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
}
const OUTER_FAR = 1.1, OUTER_NEAR = 0.35, INNER = 0.76;
export const WALLS: readonly WallRun[] = [
  { id: 'north', axis: 'x', fixed: BUILDING.minZ, from: BUILDING.minX, to: BUILDING.maxX, exterior: true, overviewHeight: OUTER_FAR },
  { id: 'south', axis: 'x', fixed: BUILDING.maxZ, from: BUILDING.minX, to: BUILDING.maxX, exterior: true, overviewHeight: OUTER_NEAR },
  { id: 'west', axis: 'z', fixed: BUILDING.minX, from: BUILDING.minZ, to: BUILDING.maxZ, exterior: true, overviewHeight: OUTER_FAR },
  { id: 'east', axis: 'z', fixed: BUILDING.maxX, from: BUILDING.minZ, to: BUILDING.maxZ, exterior: true, overviewHeight: OUTER_NEAR },
  { id: 'corridor-north', axis: 'x', fixed: CORRIDOR.minZ, from: BUILDING.minX, to: BUILDING.maxX, exterior: false, overviewHeight: INNER },
  { id: 'corridor-south', axis: 'x', fixed: CORRIDOR.maxZ, from: BUILDING.minX, to: BUILDING.maxX, exterior: false, overviewHeight: INNER },
  ...[-6, 0, 6].flatMap(x => [
    { id: `partition-north:${x}`, axis: 'z' as const, fixed: x, from: NORTH.minZ, to: NORTH.maxZ, exterior: false, overviewHeight: INNER },
    { id: `partition-south:${x}`, axis: 'z' as const, fixed: x, from: SOUTH.minZ, to: SOUTH.maxZ, exterior: false, overviewHeight: INNER },
  ]),
  { id: 'server', axis: 'z', fixed: CORRIDOR.maxX, from: CORRIDOR.minZ, to: CORRIDOR.maxZ, exterior: false, overviewHeight: INNER },
];

/** A framed window in an exterior wall, centred `at` along the wall. Placed clear of wall-mounted props. */
export interface WindowSpec { readonly wall: string; readonly at: number; readonly width: number; readonly space: SpaceId }
export const WINDOWS: readonly WindowSpec[] = [
  { wall: 'west', at: -6, width: 1.6, space: 'collections' },
  { wall: 'west', at: 3, width: 1.6, space: 'lobby' },
  { wall: 'west', at: 5.6, width: 1.6, space: 'lobby' },
  { wall: 'west', at: -3, width: 1.6, space: 'collections' },
  { wall: 'north', at: -0.8, width: 1.2, space: 'payables' },
  { wall: 'north', at: 4.9, width: 1.6, space: 'vendor_onboarding' },
  { wall: 'north', at: 7.2, width: 1.4, space: 'meeting' },
  { wall: 'north', at: 10.8, width: 1.4, space: 'meeting' },
  { wall: 'east', at: -6, width: 1.6, space: 'meeting' },
  { wall: 'east', at: -3, width: 1.6, space: 'meeting' },
  { wall: 'east', at: 3, width: 1.6, space: 'break_room' },
  { wall: 'east', at: 6, width: 1.6, space: 'break_room' },
  { wall: 'south', at: 8, width: 1.6, space: 'break_room' },
  { wall: 'south', at: 10.6, width: 1.6, space: 'break_room' },
  { wall: 'south', at: -1.5, width: 1.6, space: 'dana' },
  { wall: 'south', at: -4.5, width: 1.6, space: 'dana' },
  { wall: 'south', at: -10.4, width: 1.6, space: 'lobby' },
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
    const height = mode === 'full' ? WALL_HEIGHT : wall.overviewHeight;
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

const FRAME = 0.07, FRAME_DEPTH = WALL_THICKNESS + 0.06;
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

let SIGHT_WALLS: Rect[] | null = null;
/**
 * True when a wall (or a locked door) stands between two floor points, ignoring doorway gaps. First-person
 * views use it to hide screen-space labels for things behind walls; it is a 2D test, so headers and window
 * openings count as solid.
 */
export function sightBlocked(from: Vec2, to: Vec2): boolean {
  SIGHT_WALLS ??= wallColliders();
  const dx = to[0] - from[0], dz = to[1] - from[1];
  return SIGHT_WALLS.some(box => {
    let t0 = 0, t1 = 1;
    for (const [start, delta, min, max] of [[from[0], dx, box.minX, box.maxX], [from[1], dz, box.minZ, box.maxZ]] as const) {
      if (Math.abs(delta) < 1e-12) {
        if (start < min || start > max) return false;
        continue;
      }
      let a = (min - start) / delta, b = (max - start) / delta;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return false;
    }
    return true;
  });
}

/** Floor pad inset from a room's walls (the cream pad scene.tsx draws, tinted when the room is focused). */
export const PAD_INSET = 0.25;
export function roomPad(rect: Rect): Rect {
  return { minX: rect.minX + PAD_INSET, maxX: rect.maxX - PAD_INSET, minZ: rect.minZ + PAD_INSET, maxZ: rect.maxZ - PAD_INSET };
}

/** Which space a floor point is in (rooms first, so a doorway's sill counts as the room), or null outside. */
export function spaceAt([x, z]: Vec2): SpaceId | null {
  const inside = (r: Rect) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
  return SPACE_IDS.find(id => SPACES[id].kind === 'room' && inside(SPACES[id].rect))
    ?? (inside(CORRIDOR) ? 'corridor' : null);
}

/** Where a teleport lands: floor position and yaw (yaw 0 looks toward -z). `space` is where that point is. */
export interface RoomSpawn { readonly position: Vec2; readonly yaw: number; readonly space: SpaceId }
/**
 * One spawn per space, just inside its doorway and facing in. The Treasury is locked, so its spawn is on the
 * corridor side of its door, facing it. Kept clear of every collider (see layout.test.ts).
 */
export const ROOM_SPAWNS: Readonly<Record<SpaceId, RoomSpawn>> = {
  corridor: { position: [-9, 0.6], yaw: 0, space: 'corridor' },
  lobby: { position: [-7.2, 6.7], yaw: 0, space: 'lobby' },
  collections: { position: [-9, -2.3], yaw: 0, space: 'collections' },
  payables: { position: [-3.5, -2.3], yaw: 0, space: 'payables' },
  vendor_onboarding: { position: [2.5, -2.3], yaw: 0, space: 'vendor_onboarding' },
  meeting: { position: [8, -2.3], yaw: 0, space: 'meeting' },
  dana: { position: [-3.5, 2.3], yaw: Math.PI, space: 'dana' },
  treasury: { position: [2.5, 0.6], yaw: Math.PI, space: 'corridor' },
  break_room: { position: [8, 2.3], yaw: Math.PI, space: 'break_room' },
  server_room: { position: [10.2, 0.5], yaw: -Math.PI / 2, space: 'server_room' },
};
