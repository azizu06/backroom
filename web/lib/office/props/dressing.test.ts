import { describe, expect, it } from 'vitest';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type AnchorId, type OfficeSnapshot } from '../state';
import {
  DRESSING, DRESSING_INSTANCE_LIMIT, PLANT_POT, PLANT_RADIUS, ROUTE_ARROW, ROUTE_DASH, ROUTE_GAP, ROUTE_WIDTH, SIGN_HEIGHT,
  dressingBoxes, dressingColliders, dressingFor, paintKey, polylineLength, routeArrow, routeDashes, routePaint,
  type DressingBox, type FloorPoint, type PaintSegment,
} from './dressing';
import { FLOOR as PLAY_FLOOR, PLAYER_RADIUS, SPAWN, insideAny, movePlayer, officeColliders, type Box as PlayBox } from '../play';
import { OFFICE_PROP_INTERACTIONS } from './index';

const snapshot = (patch: Partial<OfficeSnapshot> = {}): OfficeSnapshot => ({ ...INITIAL_OFFICE, connection: 'preview', ...patch });
const withRooms = (...ids: AnchorId[]) => snapshot({ rooms: ids.map(id => ({ id, rowId: `row:${id}` })) });

/** Floor-plane AABB: x and z ranges. */
interface Box { name: string; x0: number; x1: number; z0: number; z1: number }
const rect = (name: string, cx: number, cz: number, w: number, d: number): Box => ({ name, x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 });
const span = (name: string, x0: number, x1: number, z0: number, z1: number): Box => ({ name, x0, x1, z0, z1 });
const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const inside = (a: Box, b: Box) => a.x0 >= b.x0 - 1e-9 && a.x1 <= b.x1 + 1e-9 && a.z0 >= b.z0 - 1e-9 && a.z1 <= b.z1 + 1e-9;
const contains = (b: Box, [x, z]: FloorPoint) => x >= b.x0 - 1e-9 && x <= b.x1 + 1e-9 && z >= b.z0 - 1e-9 && z <= b.z1 + 1e-9;
function footprint(box: DressingBox, name: string): Box {
  const cos = Math.abs(Math.cos(box.rotationY)), sin = Math.abs(Math.sin(box.rotationY));
  const [w, , d] = box.size;
  return rect(name, box.position[0], box.position[2], w * cos + d * sin, w * sin + d * cos);
}

// Sizes as rendered in scene.tsx and the existing props.
const FLOOR = span('floor', -8, 8, -5.5, 5.5);
/** Inside the low walls' inner faces (back wall at z=-5.5 and left wall at x=-8, both 0.16 thick). */
const ROOM_INTERIOR = span('interior', -7.92, 8, -5.42, 5.5);
const deskRooms = ['collections', 'payables', 'vendor_onboarding', 'dana'] as const;
const topRooms = ['collections', 'payables', 'vendor_onboarding'] as const;
const desks = deskRooms.map(room => {
  const [x, z] = OFFICE_ANCHORS[room].center;
  // Desk 2.25 x 1.05 plus the chair (back at 1.14 + 0.06 behind centre); Dana's desk is turned around.
  return room === 'dana' ? span(`${room} desk`, x - 1.125, x + 1.125, z - 0.525, z + 1.2) : span(`${room} desk`, x - 1.125, x + 1.125, z - 1.2, z + 0.525);
});
const doorPosts = [...topRooms.map(room => ({ x: OFFICE_ANCHORS[room].center[0], z: -0.65 })), { x: 5, z: 1.15 }]
  .flatMap(({ x, z }) => [-0.72, 0.72].map(dx => rect('door post', x + dx, z, 0.14, 0.18)));
const OBSTACLES: Box[] = [
  ...desks,
  span('vault', 4.1, 5.9, 3.23, 4.625),
  span('lobby board', -6.9, -4.9, 3.79, 3.975),
  rect('inbox tray', -4.4, 3.1, 0.8, 1),
  span('whiteboard', -0.1, 2.3, -5.41, -5.17),
  span('clock', -7.94, -7.84, 0.2, 1.0),
  ...[[-7.1, -4.6], [7.1, -4.6], [1.7, 4.5]].map(([x, z]) => rect('plant', x!, z!, 1, 1)),
  ...[-2.5, 2.5].flatMap(x => [rect('partition', x, -3.15, 0.12, 4.6), rect('partition', x, 3.5, 0.12, 3.8)]),
  span('treasury door keep-clear', 3.5, 6.5, 0.5, 1.8),
  // GX10 ServerRoom (web/app/office/rooms/ServerRoom.tsx) at (7.1, -0.8): plinth 1.2 x 1.05, plus a 0.1 margin.
  rect('server room', 7.1, -0.8, 1.2 + 0.2, 1.05 + 0.2),
];
const AISLE = rect('aisle', 0, 0.6, 15.8, 1.3);
const pad = (room: AnchorId) => {
  const [x, z] = OFFICE_ANCHORS[room].center;
  return rect(`${room} pad`, x, z, 4.25, room === 'lobby' ? 3.6 : 3.4);
};
const PADS = (Object.keys(OFFICE_ANCHORS) as AnchorId[]).map(pad);
/** Doorway approaches between the aisle and each route target's pad, one door wide. */
const APPROACHES = [...topRooms.map(room => span(`${room} approach`, OFFICE_ANCHORS[room].center[0] - 0.65, OFFICE_ANCHORS[room].center[0] + 0.65, -1.3, -0.05)),
  span('dana approach', -0.65, 0.65, 1.25, 1.7)];
const WALKWAY = [AISLE, ...PADS, ...APPROACHES];

const boxes = dressingBoxes(DRESSING);
const foliage = DRESSING.plants.map(({ x, z, size }) => rect('foliage', x, z, 2 * PLANT_RADIUS * size, 2 * PLANT_RADIUS * size));
const length = ([a, b]: readonly [FloorPoint, FloorPoint]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const segLength = (segment: PaintSegment) => length([segment.from, segment.to]);
/** The four corners of a painted strip ROUTE_WIDTH wide, as dressingBoxes renders it. */
function paintCorners({ from, to }: PaintSegment): FloorPoint[] {
  const len = segLength({ from, to }), half = ROUTE_WIDTH / 2;
  const nx = -(to[1] - from[1]) / len * half, nz = (to[0] - from[0]) / len * half;
  return [from, to].flatMap(([x, z]) => [[x + nx, z + nz], [x - nx, z - nz]] as FloorPoint[]);
}
const toRect = (name: string, b: PlayBox): Box => span(name, b.minX, b.maxX, b.minZ, b.maxZ);

describe('room dressing layout', () => {
  it('keeps every item on the floor and inside the walls', () => {
    for (const [i, box] of boxes.entries()) {
      const area = footprint(box, `${box.kind} ${i}`);
      expect(inside(area, FLOOR), area.name).toBe(true);
      expect(inside(area, ROOM_INTERIOR), area.name).toBe(true);
      expect(box.position[1] - box.size[1] / 2, area.name).toBeGreaterThanOrEqual(-1e-9);
    }
    for (const area of foliage) expect(inside(area, ROOM_INTERIOR), area.name).toBe(true);
  });

  it('overlaps no desk, vault, lobby board or tray, whiteboard, clock, plant, partition or the Treasury door area', () => {
    const areas = [...boxes.map((box, i) => footprint(box, `${box.kind} ${i}`)), ...foliage];
    for (const area of areas) for (const obstacle of OBSTACLES) expect(overlaps(area, obstacle), `${area.name} vs ${obstacle.name}`).toBe(false);
    // Door posts too, except the sign posts that stand on them.
    for (const [i, box] of boxes.entries()) {
      if (box.kind === 'sign') continue;
      for (const post of doorPosts) expect(overlaps(footprint(box, `${box.kind} ${i}`), post), `${box.kind} ${i} vs door post`).toBe(false);
    }
  });

  it('puts one shelf in each top room against the back wall and one on the lobby left wall', () => {
    expect(DRESSING.shelves.map(shelf => shelf.room).sort()).toEqual(['collections', 'lobby', 'payables', 'vendor_onboarding']);
    for (const shelf of DRESSING.shelves) {
      if (shelf.room === 'lobby') {
        expect(shelf.rotationY).toBeCloseTo(Math.PI / 2);
        expect(shelf.x).toBeLessThan(-7.5);
        expect(Math.abs(shelf.z - OFFICE_ANCHORS.lobby.center[1]) + shelf.width / 2).toBeLessThanOrEqual(3.6 / 2);
      } else {
        expect(shelf.rotationY).toBe(0);
        expect(shelf.z).toBeLessThan(-5);
        expect(Math.abs(shelf.x - OFFICE_ANCHORS[shelf.room].center[0])).toBeLessThan(2.5 - shelf.width / 2);
      }
    }
    // Plants never overlap one another.
    for (const [i, a] of foliage.entries()) for (const b of foliage.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
  });

  it('hangs a room-name plaque over each top-room doorway, facing +z, above the deny flash and passing avatars', () => {
    expect(DRESSING.signs.map(sign => sign.room)).toEqual([...topRooms]);
    for (const sign of DRESSING.signs) {
      expect(sign).toMatchObject({ x: OFFICE_ANCHORS[sign.room].center[0], z: -0.65, rotationY: 0, text: OFFICE_ANCHORS[sign.room].name });
      expect(sign.y - SIGN_HEIGHT / 2).toBeGreaterThan(1.55);
    }
  });

  it('stays a modest instanced mesh', () => {
    expect(boxes.length).toBeLessThan(DRESSING_INSTANCE_LIMIT);
    expect(DRESSING_INSTANCE_LIMIT).toBeLessThanOrEqual(150);
  });

  it('is decoration only, with no prop interaction', () => {
    expect(OFFICE_PROP_INTERACTIONS.map(prop => prop.id)).not.toContain('dressing');
  });
});

describe('floor routes', () => {
  it('run from the lobby to each top-room door and to Dana’s desk', () => {
    expect(DRESSING.routes.map(route => `${route.from}>${route.to}`)).toEqual(['lobby>collections', 'lobby>payables', 'lobby>vendor_onboarding', 'lobby>dana']);
    for (const route of DRESSING.routes) {
      expect(route.points[0]).toEqual(OFFICE_ANCHORS.lobby.center);
      const end = route.points.at(-1)!;
      if (route.to === 'dana') expect(contains(pad('dana'), end) && !overlaps(rect('end', end[0], end[1], 0, 0), desks[3]!)).toBe(true);
      else expect(end).toEqual([OFFICE_ANCHORS[route.to].center[0], -0.65]);
      // Along the aisle centre line, except where the Vendor route drops below the Treasury door area.
      expect(route.points[1]).toEqual([-5, 0.6]);
    }
  });

  it('keep every point, dash and chevron on the floor, within the aisle, room pads or doorway approaches', () => {
    for (const route of DRESSING.routes) for (const point of route.points) {
      expect(contains(FLOOR, point), `${route.to} ${point}`).toBe(true);
      expect(WALKWAY.some(area => contains(area, point)), `${route.to} ${point}`).toBe(true);
    }
    // Every corner of each painted strip (ROUTE_WIDTH wide), not just its centre line.
    for (const segment of routePaint(DRESSING.routes)) for (const point of paintCorners(segment)) {
      expect(contains(FLOOR, point), `paint ${point}`).toBe(true);
      expect(WALKWAY.some(area => contains(area, point)), `paint ${point}`).toBe(true);
    }
    for (const box of boxes.filter(box => box.kind === 'paint')) {
      expect(box.size[1]).toBeLessThanOrEqual(0.01);
      expect(box.position[1]).toBeGreaterThan(0.02);
      expect(box.position[1]).toBeLessThan(0.06);
    }
  });

  it('draw shared trunk dashes once', () => {
    const all = DRESSING.routes.flatMap(route => [...routeDashes(route.points, ROUTE_DASH, ROUTE_GAP), ...routeArrow(route.points, ROUTE_ARROW)]);
    const painted = routePaint(DRESSING.routes);
    const keys = painted.map(paintKey);
    expect(painted.length).toBeLessThan(all.length);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(all.map(paintKey))).toEqual(new Set(keys));
    expect(paintKey({ from: [1, 2], to: [3, 4] })).toBe(paintKey({ from: [3, 4], to: [1, 2] }));
  });
});

/** Joins pieces that continue one another (a dash split at a corner) back into whole dashes. */
function wholeDashes(pieces: PaintSegment[]): number[] {
  const out: number[] = [];
  pieces.forEach((piece, i) => {
    const previous = pieces[i - 1];
    if (previous && length([previous.to, piece.from]) < 1e-9) out[out.length - 1]! += segLength(piece);
    else out.push(segLength(piece));
  });
  return out;
}

describe('routeDashes', () => {
  it('covers a straight line with the expected count', () => {
    const line: FloorPoint[] = [[0, 0], [3, 0]];
    const dashes = routeDashes(line, 0.3, 0.2);
    expect(dashes).toHaveLength(6);
    expect(dashes[0]).toEqual({ from: [0, 0], to: [0.3, 0] });
    expect(dashes.reduce((sum, s) => sum + segLength(s), 0)).toBeCloseTo(1.8);
    const longer = routeDashes([[0, 0], [3.1, 0]], 0.3, 0.2);
    expect(longer).toHaveLength(7);
    expect(segLength(longer.at(-1)!)).toBeCloseTo(0.1);
    expect(longer.at(-1)!.to[0]).toBeCloseTo(3.1);
  });

  it('runs the pattern on across corners, splitting a dash at the corner', () => {
    const pieces = routeDashes([[0, 0], [1, 0], [1, 1]], 0.5, 0.2);
    expect(pieces).toHaveLength(4);
    expect(pieces[1]!.to).toEqual([1, 0]);
    expect(pieces[2]!.from).toEqual([1, 0]);
    expect(pieces[2]!.to[1]).toBeCloseTo(0.2);
    expect(wholeDashes(pieces).map(n => +n.toFixed(6))).toEqual([0.5, 0.5, 0.5]);
  });

  it('covers every route polyline: count, painted length and reach to the end', () => {
    const period = ROUTE_DASH + ROUTE_GAP;
    for (const { points, to } of DRESSING.routes) {
      const total = polylineLength(points);
      const pieces = routeDashes(points, ROUTE_DASH, ROUTE_GAP);
      const whole = Math.floor(total / period), rest = total - whole * period;
      const expected = whole + (rest > 1e-9 ? 1 : 0);
      expect(wholeDashes(pieces), to).toHaveLength(expected);
      const painted = whole * ROUTE_DASH + Math.min(ROUTE_DASH, rest);
      expect(pieces.reduce((sum, s) => sum + segLength(s), 0), to).toBeCloseTo(painted, 6);
      expect(pieces[0]!.from, to).toEqual(points[0]);
      expect(length([pieces.at(-1)!.to, points.at(-1)!]), to).toBeLessThanOrEqual(ROUTE_GAP + 1e-9);
      for (const piece of pieces) expect(segLength(piece)).toBeLessThanOrEqual(ROUTE_DASH + 1e-9);
    }
  });

  it('skips zero-length segments and rejects a bad pattern', () => {
    expect(routeDashes([[0, 0], [0, 0], [1, 0]], 0.3, 0.2)).toHaveLength(2);
    expect(routeDashes([[0, 0]], 0.3, 0.2)).toEqual([]);
    expect(() => routeDashes([[0, 0], [1, 0]], 0, 0.2)).toThrow(RangeError);
    expect(() => routeDashes([[0, 0], [1, 0]], 0.3, -1)).toThrow(RangeError);
  });

  it('points the end chevron along the last segment', () => {
    const [left, right] = routeArrow([[0, 0], [0, -2]], 0.3);
    for (const arm of [left!, right!]) {
      expect(arm.from).toEqual([0, -2]);
      expect(arm.to[1]).toBeCloseTo(-2 + 0.3 * Math.SQRT1_2);
      expect(Math.abs(arm.to[0])).toBeCloseTo(0.3 * Math.SQRT1_2);
    }
    expect(Math.sign(left!.to[0])).toBe(-Math.sign(right!.to[0]));
    expect(routeArrow([[1, 1]], 0.3)).toEqual([]);
  });
});

describe('dressingFor', () => {
  it('shows everything when the snapshot does not list rooms', () => {
    expect(dressingFor(snapshot({ rooms: undefined }))).toEqual(DRESSING);
  });

  it('hides rooms that are not visible', () => {
    const empty = dressingFor(withRooms());
    expect(empty).toEqual({ shelves: [], plants: [], signs: [], routes: [] });
    expect(dressingBoxes(empty)).toEqual([]);
    const lobby = dressingFor(withRooms('lobby'));
    expect(lobby.shelves.map(s => s.room)).toEqual(['lobby']);
    expect(lobby.plants.map(p => p.room)).toEqual(['lobby']);
    expect(lobby.signs).toEqual([]);
    expect(lobby.routes).toEqual([]);
  });

  it('shows a route only while both ends are visible', () => {
    expect(dressingFor(withRooms('payables')).routes).toEqual([]);
    expect(dressingFor(withRooms('payables')).signs.map(s => s.room)).toEqual(['payables']);
    expect(dressingFor(withRooms('lobby', 'payables', 'treasury')).routes.map(r => r.to)).toEqual(['payables']);
    expect(dressingFor(withRooms('dana', 'lobby')).routes.map(r => r.to)).toEqual(['dana']);
    const treasury = dressingFor(withRooms('treasury'));
    expect(treasury).toEqual({ shelves: [], plants: DRESSING.plants.filter(p => p.room === 'treasury'), signs: [], routes: [] });
  });
});

describe('dressingColliders', () => {
  const allRooms = Object.keys(OFFICE_ANCHORS) as AnchorId[];
  const colliders = dressingColliders(allRooms);

  it('gives every shelf and plant a collider covering what is drawn', () => {
    expect(colliders).toHaveLength(DRESSING.shelves.length + DRESSING.plants.length);
    const rects = colliders.map((c, i) => toRect(`collider ${i}`, c));
    for (const [i, box] of boxes.entries()) {
      if (box.kind !== 'shelf' && box.kind !== 'book' && box.kind !== 'pot') continue;
      const area = footprint(box, `${box.kind} ${i}`);
      expect(rects.some(r => inside(area, r)), area.name).toBe(true);
    }
    for (const area of foliage) expect(rects.some(r => inside(area, r)), area.name).toBe(true);
    for (const { x, z, size } of DRESSING.plants) {
      expect(rects.some(r => inside(rect('pot', x, z, PLANT_POT * size, PLANT_POT * size), r))).toBe(true);
    }
    for (const c of colliders) expect(c.maxX - c.minX > 0 && c.maxZ - c.minZ > 0).toBe(true);
  });

  it('filters by visible rooms like dressingFor', () => {
    expect(dressingColliders([])).toEqual([]);
    for (const room of allRooms) {
      const shown = dressingFor(withRooms(room));
      expect(dressingColliders([room]), room).toHaveLength(shown.shelves.length + shown.plants.length);
    }
    expect(dressingColliders(['lobby'])).toHaveLength(2);
  });

  it('stays clear of the Play spawn and the aisle walking line', () => {
    expect(insideAny(SPAWN.position, colliders, PLAYER_RADIUS)).toBe(false);
    const walkingLine = span('aisle walking line', -7.5, 7.5, 0.3, 0.9);
    for (const [i, c] of colliders.entries()) expect(overlaps(toRect(`collider ${i}`, c), walkingLine), `collider ${i}`).toBe(false);
    for (const c of colliders) {
      expect(c.minX >= PLAY_FLOOR.minX && c.maxX <= PLAY_FLOOR.maxX && c.minZ >= PLAY_FLOOR.minZ && c.maxZ <= PLAY_FLOOR.maxZ).toBe(true);
    }
  });

  it('lets the player walk the whole aisle with the office colliders', () => {
    const solid = officeColliders(allRooms, colliders);
    for (const [from, to] of [[-7.5, 7.5], [7.5, -7.5]] as const) {
      let position: [number, number] = [from, 0.6];
      const step = Math.sign(to - from) * 0.05;
      while ((to - position[0]) * Math.sign(step) > 1e-6) {
        const next = movePlayer(position, [Math.abs(to - position[0]) < Math.abs(step) ? to - position[0] : step, 0], solid);
        expect(next[0], `stuck at ${position}`).not.toBe(position[0]);
        position = next;
      }
      expect(position[1]).toBe(0.6);
    }
  });
});
