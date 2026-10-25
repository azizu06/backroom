import { describe, expect, it } from 'vitest';
import { PALETTE } from '../palette';
import { OFFICE_ANCHORS, type AnchorId } from '../state';
import { officeColliders, PAYLINK_KIOSK, PLAYER_RADIUS, SERVER_ROOM, SPAWN, TREASURY_DOOR, type Box } from '../play';
import { BUILDING, CORRIDOR, CORRIDOR_Z, SPACES, WALL_HEIGHT, WALL_THICKNESS, roomPoint } from '../layout';
import { PHONE_INTERACTION } from './phone';
import { DRESSING, dressingColliders } from './dressing';
import { monitorStandPosition, MONITOR_DESKS } from './monitors';
import { ROOM_DETAILS, roomDetailsInRooms, type DetailPiece } from './roomDetail';

const rooms = Object.keys(OFFICE_ANCHORS) as AnchorId[];
const pieces = ROOM_DETAILS.flatMap(detail => detail.pieces);
const rect = (x: number, z: number, width: number, depth: number): Box =>
  ({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 });
const overlaps = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const contains = (a: Box, b: Box) => b.minX >= a.minX - 1e-9 && b.maxX <= a.maxX + 1e-9
  && b.minZ >= a.minZ - 1e-9 && b.maxZ <= a.maxZ + 1e-9;
function footprint(piece: DetailPiece): Box {
  const angle = piece.rotation?.[1] ?? 0;
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  return rect(piece.at[0], piece.at[2], piece.size[0] * cos + piece.size[2] * sin, piece.size[0] * sin + piece.size[2] * cos);
}

/** Architectural interiors: each room's wall inner faces (../layout). */
function roomBounds(room: AnchorId): Box {
  const r = SPACES[room].rect, half = WALL_THICKNESS / 2;
  return { minX: r.minX + half, maxX: r.maxX - half, minZ: r.minZ + half, maxZ: r.maxZ - half };
}
const at = (room: AnchorId, dx: number, dz: number) => roomPoint(room, dx, dz);

// Deliberately independent of the detail layout: keep the aisle, desk approaches, targets and
// player-sized corridors along all existing wayfinding routes free, including flat decorations.
const paths: Box[] = [
  rect((CORRIDOR.minX + CORRIDOR.maxX) / 2, CORRIDOR_Z, CORRIDOR.maxX - CORRIDOR.minX, 1.3),
  ...(['collections', 'payables', 'vendor_onboarding'] as const).map(room =>
    ({ minX: OFFICE_ANCHORS[room].center[0] - 0.65, maxX: OFFICE_ANCHORS[room].center[0] + 0.65, minZ: CORRIDOR.minZ - 1.8, maxZ: CORRIDOR_Z })),
  { minX: OFFICE_ANCHORS.dana.center[0] - 0.65, maxX: OFFICE_ANCHORS.dana.center[0] + 0.65, minZ: CORRIDOR.maxZ - 0.35, maxZ: OFFICE_ANCHORS.dana.center[1] - 0.525 },
  { minX: TREASURY_DOOR[0] - 1.5, maxX: TREASURY_DOOR[0] + 1.5, minZ: TREASURY_DOOR[1] - 0.65, maxZ: TREASURY_DOOR[1] + 0.65 },
  { minX: SERVER_ROOM.position[0] - 0.7, maxX: SERVER_ROOM.position[0] + 0.7, minZ: SERVER_ROOM.position[1] - 0.7, maxZ: SERVER_ROOM.position[1] + 1.25 },
  { minX: PAYLINK_KIOSK[0] - 0.5, maxX: PAYLINK_KIOSK[0] + 0.5, minZ: PAYLINK_KIOSK[1] - 1.85, maxZ: PAYLINK_KIOSK[1] - 0.5 },
  { minX: PHONE_INTERACTION.position[0] - PLAYER_RADIUS, maxX: PHONE_INTERACTION.position[0] + PLAYER_RADIUS, minZ: at('collections', 0, 0.53)[1], maxZ: at('collections', 0, 1.7)[1] },
  rect(...SPAWN.position, PLAYER_RADIUS * 2, PLAYER_RADIUS * 2),
  ...MONITOR_DESKS.map(room => rect(...monitorStandPosition(room), PLAYER_RADIUS * 2, PLAYER_RADIUS * 2)),
  ...DRESSING.routes.flatMap(route => route.points.slice(1).map((end, index) => {
    const start = route.points[index]!;
    return { minX: Math.min(start[0], end[0]) - PLAYER_RADIUS, maxX: Math.max(start[0], end[0]) + PLAYER_RADIUS,
      minZ: Math.min(start[1], end[1]) - PLAYER_RADIUS, maxZ: Math.max(start[1], end[1]) + PLAYER_RADIUS };
  })),
];

describe('pastel room details', () => {
  it('gives every room a rug, wall art and a potted plant, with clutter at all four desks', () => {
    expect(new Set(ROOM_DETAILS.map(detail => detail.id)).size).toBe(ROOM_DETAILS.length);
    for (const room of rooms) {
      const kinds = roomDetailsInRooms([room]).map(detail => detail.kind);
      expect(kinds, room).toEqual(expect.arrayContaining(['rug', 'art', 'plant']));
      if (MONITOR_DESKS.includes(room as typeof MONITOR_DESKS[number])) {
        expect(kinds, room).toEqual(expect.arrayContaining(['mug', 'papers', 'books', 'lamp']));
      }
    }
  });

  it('keeps every rendered part inside its own room and outside walk paths', () => {
    for (const detail of ROOM_DETAILS) for (const piece of detail.pieces) {
      const bounds = footprint(piece);
      expect(contains(roomBounds(detail.room), bounds), detail.id).toBe(true);
      expect(piece.at[1] - piece.size[1] / 2, detail.id).toBeGreaterThanOrEqual(0);
      for (const path of paths) expect(overlaps(bounds, path), `${detail.id} at ${piece.at}`).toBe(false);
    }
  });

  it('keeps solid props over existing colliders, rugs flat, and artwork attached below wall tops', () => {
    const supports = officeColliders(rooms, dressingColliders(rooms));
    for (const detail of ROOM_DETAILS) for (const piece of detail.pieces) {
      if (detail.kind === 'rug') {
        expect(piece.at[1] + piece.size[1] / 2).toBeLessThanOrEqual(0.062);
      } else if (detail.kind === 'art') {
        const [x, y, z] = piece.at;
        const face = WALL_THICKNESS / 2;
        const onShell = Math.abs(x - (BUILDING.minX + face)) < 0.1 || Math.abs(z - (BUILDING.minZ + face)) < 0.1;
        const onPartition = [-6, 0, 6].some(wall => Math.abs(Math.abs(x - wall) - face) < 0.1);
        expect(onShell || onPartition, detail.id).toBe(true);
        expect(y + piece.size[1] / 2, detail.id).toBeLessThanOrEqual(WALL_HEIGHT);
      } else {
        expect(supports.some(support => contains(support, footprint(piece))), detail.id).toBe(true);
        expect(piece.at[1] - piece.size[1] / 2, detail.id).toBeGreaterThanOrEqual(0.9 - 1e-9);
      }
    }
  });

  it('leaves the Collections handset and enlarged monitor faces unobstructed', () => {
    const phone = rect(...PHONE_INTERACTION.position, 0.36, 0.28);
    for (const detail of roomDetailsInRooms(['collections'])) for (const piece of detail.pieces) {
      expect(overlaps(footprint(piece), phone), detail.id).toBe(false);
    }
    for (const room of MONITOR_DESKS) {
      const [x, z] = OFFICE_ANCHORS[room].center, flip = room === 'dana' ? -1 : 1;
      const monitor = rect(x - 0.15 * flip, z - 0.23 * flip, 1.9, 0.08);
      for (const detail of roomDetailsInRooms([room])) for (const piece of detail.pieces) {
        expect(overlaps(footprint(piece), monitor), detail.id).toBe(false);
      }
    }
  });

  it('uses palette colours and stays within two cheap primitive batches', () => {
    const colors = new Set<string>(Object.values(PALETTE));
    expect(pieces.length).toBeLessThanOrEqual(150);
    expect(new Set(pieces.map(piece => piece.shape))).toEqual(new Set(['box', 'cylinder']));
    expect(pieces.reduce((triangles, piece) => triangles + (piece.shape === 'box' ? 12 : 32), 0)).toBeLessThanOrEqual(2600);
    for (const piece of pieces) {
      expect(colors.has(piece.color)).toBe(true);
      expect(piece.size.every(size => Number.isFinite(size) && size > 0)).toBe(true);
    }
  });

  it('filters hidden rooms without changing the static item identities', () => {
    expect(roomDetailsInRooms([])).toEqual([]);
    expect(roomDetailsInRooms(rooms)).toEqual(ROOM_DETAILS);
    for (const room of rooms) expect(roomDetailsInRooms([room])).toEqual(ROOM_DETAILS.filter(detail => detail.room === room));
    expect(roomDetailsInRooms([...rooms].reverse())).toEqual(ROOM_DETAILS);
  });
});
