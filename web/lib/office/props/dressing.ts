import type { Box } from '../play';
import { OFFICE_ANCHORS, visibleRooms, type AnchorId, type OfficeSnapshot } from '../state';
import { PALETTE, ROLES } from '../palette';

/** Floor (x, z). */
export type FloorPoint = readonly [x: number, z: number];
export interface DressingShelf { room: AnchorId; x: number; z: number; rotationY: number; width: number }
/** `room` (beyond the floor position) ties the plant to a room so it hides with it. */
export interface DressingPlant { room: AnchorId; x: number; z: number; size: number }
export interface DressingSign { room: AnchorId; x: number; y: number; z: number; rotationY: number; text: string }
export interface DressingRoute { from: AnchorId; to: AnchorId; points: readonly FloorPoint[] }
export interface Dressing {
  shelves: readonly DressingShelf[];
  plants: readonly DressingPlant[];
  signs: readonly DressingSign[];
  routes: readonly DressingRoute[];
}

export const SHELF_DEPTH = 0.34, SHELF_HEIGHT = 0.9, SHELF_BOARD = 0.04;
/** Foliage radius at size 1 (same dodecahedron as scene.tsx's Plant); the pot is narrower. */
export const PLANT_RADIUS = 0.5, PLANT_POT = 0.46, PLANT_POT_HEIGHT = 0.44, PLANT_FOLIAGE_Y = 0.8;
/** Plaque between upward extensions of the door posts (x = centre ± 0.72, top 1.04 in scene.tsx). */
export const SIGN_WIDTH = 1.34, SIGN_HEIGHT = 0.34, SIGN_DEPTH = 0.05, SIGN_FACE_WIDTH = 1.2, SIGN_FACE_HEIGHT = 0.3;
export const SIGN_POST_X = 0.72, SIGN_POST_SIZE = 0.1, DOOR_POST_TOP = 1.04;
export const ROUTE_DASH = 0.3, ROUTE_GAP = 0.22, ROUTE_WIDTH = 0.07, ROUTE_ARROW = 0.26, ROUTE_THICKNESS = 0.01;
export const ROUTE_COLOR = PALETTE.cream;
/** Upper bound for the dressing's one instanced mesh. */
export const DRESSING_INSTANCE_LIMIT = 150;

const BACK_WALL_FACE = -5.42, LEFT_WALL_FACE = -7.92;
const BACK_SHELF_Z = BACK_WALL_FACE + SHELF_DEPTH / 2 + 0.01;
const TOP_DOOR_Z = -0.65, AISLE_Z = 0.6;
/** Bottom 1.58: clears the door's deny flash (top 1.3) and avatars (hair top ~1.54) walking through the doorway. */
const SIGN_Y = 1.75;
const LOBBY = OFFICE_ANCHORS.lobby.center;
const door = (room: 'collections' | 'payables' | 'vendor_onboarding'): FloorPoint => [OFFICE_ANCHORS[room].center[0], TOP_DOOR_Z];
const sign = (room: 'collections' | 'payables' | 'vendor_onboarding'): DressingSign =>
  ({ room, x: OFFICE_ANCHORS[room].center[0], y: SIGN_Y, z: TOP_DOOR_Z, rotationY: 0, text: OFFICE_ANCHORS[room].name });

export const DRESSING: Dressing = {
  shelves: [
    { room: 'collections', x: -4.4, z: BACK_SHELF_Z, rotationY: 0, width: 1.5 },
    { room: 'payables', x: -1.25, z: BACK_SHELF_Z, rotationY: 0, width: 1.3 },
    { room: 'vendor_onboarding', x: 4.4, z: BACK_SHELF_Z, rotationY: 0, width: 1.5 },
    // Near the lobby's back edge so the audit board (z = 3.9) does not hide it from the camera.
    { room: 'lobby', x: LEFT_WALL_FACE + SHELF_DEPTH / 2 + 0.01, z: 1.8, rotationY: Math.PI / 2, width: 1.2 },
  ],
  plants: [
    { room: 'lobby', x: -7.4, z: 4.95, size: 0.6 },
    { room: 'dana', x: -1.85, z: 4.95, size: 0.6 },
    { room: 'treasury', x: 7.4, z: 4.95, size: 0.6 },
    // Just inside the x = 2.5 partition; the GX10 server room occupies the right front corner.
    { room: 'vendor_onboarding', x: 3.1, z: -1.05, size: 0.6 },
  ],
  signs: [sign('collections'), sign('payables'), sign('vendor_onboarding')],
  routes: [
    { from: 'lobby', to: 'collections', points: [LOBBY, [-5, AISLE_Z], door('collections')] },
    { from: 'lobby', to: 'payables', points: [LOBBY, [-5, AISLE_Z], [0, AISLE_Z], door('payables')] },
    // Drops to z = 0.25 before x = 3.5 so the Treasury door area (x 3.5..6.5, z 0.5..1.8) stays clear.
    { from: 'lobby', to: 'vendor_onboarding', points: [LOBBY, [-5, AISLE_Z], [3.1, AISLE_Z], [3.1, 0.25], [5, 0.25], door('vendor_onboarding')] },
    // Stops in front of Dana's desk (front edge z = 2.875).
    { from: 'lobby', to: 'dana', points: [LOBBY, [-5, AISLE_Z], [0, AISLE_Z], [0, 2.55]] },
  ],
};

/** A room's dressing shows only while the room is visible; a route only while both ends are. */
export function dressingFor(snapshot: OfficeSnapshot, dressing: Dressing = DRESSING): Dressing {
  return dressingInRooms(visibleRooms(snapshot), dressing);
}

export function dressingInRooms(visible: readonly AnchorId[], dressing: Dressing = DRESSING): Dressing {
  const rooms = new Set(visible);
  return {
    shelves: dressing.shelves.filter(item => rooms.has(item.room)),
    plants: dressing.plants.filter(item => rooms.has(item.room)),
    signs: dressing.signs.filter(item => rooms.has(item.room)),
    routes: dressing.routes.filter(route => rooms.has(route.from) && rooms.has(route.to)),
  };
}

const footprintBox = (x: number, z: number, width: number, depth: number): Box =>
  ({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 });

/**
 * Solid floor footprints for Play (same shape as officeColliders' boxes): every visible shelf and plant.
 * Plants use the wider of pot and foliage. Floor paint and the plaques (above the door posts) are not solid.
 */
export function dressingColliders(rooms: readonly AnchorId[], dressing: Dressing = DRESSING): Box[] {
  const { shelves, plants } = dressingInRooms(rooms, dressing);
  return [
    ...shelves.map(({ x, z, rotationY, width }) => {
      const cos = Math.abs(Math.cos(rotationY)), sin = Math.abs(Math.sin(rotationY));
      return footprintBox(x, z, width * cos + SHELF_DEPTH * sin, width * sin + SHELF_DEPTH * cos);
    }),
    ...plants.map(({ x, z, size }) => {
      const side = Math.max(PLANT_POT, 2 * PLANT_RADIUS) * size;
      return footprintBox(x, z, side, side);
    }),
  ];
}

export interface PaintSegment { from: FloorPoint; to: FloorPoint }
const EPS = 1e-9;
const lerp = (a: FloorPoint, b: FloorPoint, t: number): FloorPoint => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function polylineLength(points: readonly FloorPoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  return length;
}

/**
 * Dashes along a polyline: dash k covers distance [k(dash+gap), k(dash+gap)+dash], clipped to the end.
 * The pattern runs on across corners; a dash that crosses a corner comes back as two pieces.
 */
export function routeDashes(points: readonly FloorPoint[], dash: number, gap: number): PaintSegment[] {
  if (!(dash > 0) || !(gap >= 0)) throw new RangeError('routeDashes needs dash > 0 and gap >= 0');
  const period = dash + gap, out: PaintSegment[] = [];
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length <= EPS) continue;
    const end = start + length;
    for (let k = Math.floor(start / period); k * period < end - EPS; k++) {
      const from = Math.max(k * period, start), to = Math.min(k * period + dash, end);
      if (to - from > EPS) out.push({ from: lerp(a, b, (from - start) / length), to: lerp(a, b, (to - start) / length) });
    }
    start = end;
  }
  return out;
}

/** Two arms of a chevron whose tip is the polyline's last point, pointing along its last segment. */
export function routeArrow(points: readonly FloorPoint[], size: number): PaintSegment[] {
  let i = points.length - 1;
  while (i > 0 && Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]) <= EPS) i--;
  if (i < 1) return [];
  const tip = points[i]!, prev = points[i - 1]!;
  const heading = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
  return [-1, 1].map(side => {
    const angle = heading + Math.PI + side * Math.PI / 4;
    return { from: tip, to: [tip[0] + Math.cos(angle) * size, tip[1] + Math.sin(angle) * size] as const };
  });
}

const pointKey = (p: FloorPoint) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
/** Direction-free identity of a painted piece (to 1 mm), used to draw shared pieces once. */
export const paintKey = (segment: PaintSegment) => [pointKey(segment.from), pointKey(segment.to)].sort().join('|');

/** Every route's dashes and end chevron, with pieces shared by overlapping routes drawn once. */
export function routePaint(routes: readonly DressingRoute[]): PaintSegment[] {
  const seen = new Set<string>(), out: PaintSegment[] = [];
  for (const route of routes) {
    for (const segment of [...routeDashes(route.points, ROUTE_DASH, ROUTE_GAP), ...routeArrow(route.points, ROUTE_ARROW)]) {
      const id = paintKey(segment);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(segment);
    }
  }
  return out;
}

const insidePad = (x: number, z: number, margin: number) => (Object.keys(OFFICE_ANCHORS) as AnchorId[]).some(room => {
  const [cx, cz] = OFFICE_ANCHORS[room].center;
  return Math.abs(x - cx) <= 4.25 / 2 + margin && Math.abs(z - cz) <= (room === 'lobby' ? 3.6 : 3.4) / 2 + margin;
});
/** Centre height for floor paint: just above the aisle strip (top 0.02), or above a room pad (top 0.045) it touches. */
export function paintY(segment: PaintSegment): number {
  const touchesPad = [segment.from, segment.to].some(([x, z]) => insidePad(x, z, ROUTE_WIDTH / 2));
  return (touchesPad ? 0.046 : 0.02) + ROUTE_THICKNESS / 2;
}

export type DressingBoxKind = 'shelf' | 'book' | 'pot' | 'sign' | 'paint';
/** A unit box placed in world space: rotationY about its centre, then position. */
export interface DressingBox {
  kind: DressingBoxKind;
  position: readonly [x: number, y: number, z: number];
  size: readonly [x: number, y: number, z: number];
  rotationY: number;
  color: string;
}

const SHELF_COLOR = ROLES.partition, SHELF_BACK = ROLES.shadow, POT_COLOR = PALETTE.blush, SIGN_COLOR = ROLES.frame, POST_COLOR = ROLES.shadow;
const BOOK_COLORS = [PALETTE.blush, PALETTE.mint, PALETTE.butter, PALETTE.aqua] as const;
const BOOK_WIDTHS = [0.07, 0.09, 0.06, 0.08, 0.1] as const;
const BOOK_HEIGHTS = [0.3, 0.33, 0.26, 0.31, 0.28] as const;
const BOOKS_PER_ROW = 5;

function shelfBoxes(shelf: DressingShelf, index: number): DressingBox[] {
  const { width: w, rotationY } = shelf, d = SHELF_DEPTH, h = SHELF_HEIGHT, t = SHELF_BOARD;
  const cos = Math.cos(rotationY), sin = Math.sin(rotationY);
  // Local x runs along the shelf, local +z is its open front.
  const place = (kind: DressingBoxKind, [lx, y, lz]: readonly [number, number, number], size: DressingBox['size'], color: string): DressingBox =>
    ({ kind, position: [shelf.x + lx * cos + lz * sin, y, shelf.z - lx * sin + lz * cos], size, rotationY, color });
  const boxes = [
    place('shelf', [-w / 2 + t / 2, h / 2, 0], [t, h, d], SHELF_COLOR),
    place('shelf', [w / 2 - t / 2, h / 2, 0], [t, h, d], SHELF_COLOR),
    place('shelf', [0, h / 2, -d / 2 + 0.01], [w - 2 * t, h, 0.02], SHELF_BACK),
    ...[t / 2, h / 2, h - t / 2].map(y => place('shelf', [0, y, 0], [w - 2 * t, t, d], SHELF_COLOR)),
  ];
  const accent = OFFICE_ANCHORS[shelf.room].color;
  [t, h / 2 + t / 2].forEach((floor, row) => {
    let cursor = -w / 2 + t + 0.05 + ((index + row) % 3) * 0.06;
    for (let i = 0; i < BOOKS_PER_ROW; i++) {
      const n = index * 3 + row * 2 + i;
      const bw = BOOK_WIDTHS[n % BOOK_WIDTHS.length]!, bh = BOOK_HEIGHTS[n % BOOK_HEIGHTS.length]!;
      const color = i === 2 ? accent : BOOK_COLORS[n % BOOK_COLORS.length]!;
      boxes.push(place('book', [cursor + bw / 2, floor + bh / 2, 0.01], [bw, bh, d * 0.8], color));
      // A wider gap after the third spine so rows read as books, not a solid block.
      cursor += bw + (i === 2 ? 0.14 : 0.01);
    }
  });
  return boxes;
}

/** All unit boxes of the dressing (one instanced mesh); foliage and sign faces are drawn separately. */
export function dressingBoxes(dressing: Dressing): DressingBox[] {
  const boxes = dressing.shelves.flatMap(shelfBoxes);
  for (const { x, z, size } of dressing.plants) {
    boxes.push({ kind: 'pot', position: [x, PLANT_POT_HEIGHT * size / 2, z], size: [PLANT_POT * size, PLANT_POT_HEIGHT * size, PLANT_POT * size], rotationY: 0, color: POT_COLOR });
  }
  for (const { x, y, z, rotationY } of dressing.signs) {
    const top = y + SIGN_HEIGHT / 2;
    boxes.push({ kind: 'sign', position: [x, y, z], size: [SIGN_WIDTH, SIGN_HEIGHT, SIGN_DEPTH], rotationY, color: SIGN_COLOR });
    for (const side of [-1, 1]) {
      const along = side * SIGN_POST_X;
      boxes.push({ kind: 'sign', position: [x + along * Math.cos(rotationY), (DOOR_POST_TOP + top) / 2, z - along * Math.sin(rotationY)],
        size: [SIGN_POST_SIZE, top - DOOR_POST_TOP, SIGN_POST_SIZE], rotationY, color: POST_COLOR });
    }
  }
  for (const segment of routePaint(dressing.routes)) {
    const [ax, az] = segment.from, [bx, bz] = segment.to;
    boxes.push({ kind: 'paint', position: [(ax + bx) / 2, paintY(segment), (az + bz) / 2], size: [Math.hypot(bx - ax, bz - az), ROUTE_THICKNESS, ROUTE_WIDTH],
      rotationY: Math.atan2(-(bz - az), bx - ax), color: ROUTE_COLOR });
  }
  return boxes;
}
