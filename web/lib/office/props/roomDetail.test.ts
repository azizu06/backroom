import { describe, expect, it } from 'vitest';
import { PALETTE } from '../palette';
import { OFFICE_ANCHORS, type AnchorId } from '../state';
import { officeColliders, PLAYER_RADIUS, SPAWN, type Box } from '../play';
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

/** Architectural interiors: shell inner faces, partition faces and the ends of the partitions. */
function roomBounds(room: AnchorId): Box {
  const [x] = OFFICE_ANCHORS[room].center;
  const top = ['collections', 'payables', 'vendor_onboarding'].includes(room);
  return {
    minX: x === -5 ? -7.92 : x - 2.44, maxX: x === 5 ? 8 : x + 2.44,
    minZ: top ? -5.42 : 1.6, maxZ: top ? -0.85 : 5.4,
  };
}

// Deliberately independent of the detail layout: keep the aisle, desk approaches, targets and
// player-sized corridors along all existing wayfinding routes free, including flat decorations.
const paths: Box[] = [
  rect(0, 0.6, 15.8, 1.3),
  ...(['collections', 'payables', 'vendor_onboarding'] as const).map(room =>
    ({ minX: OFFICE_ANCHORS[room].center[0] - 0.65, maxX: OFFICE_ANCHORS[room].center[0] + 0.65, minZ: -2.45, maxZ: -0.05 })),
  { minX: -0.65, maxX: 0.65, minZ: 1.25, maxZ: 2.875 },
  { minX: 3.5, maxX: 6.5, minZ: 0.5, maxZ: 1.8 },
  { minX: 6.4, maxX: 7.8, minZ: -1.5, maxZ: 0.45 },
  { minX: -4.9, maxX: -3.9, minZ: 1.25, maxZ: 2.6 },
  { minX: PHONE_INTERACTION.position[0] - PLAYER_RADIUS, maxX: PHONE_INTERACTION.position[0] + PLAYER_RADIUS, minZ: -2.47, maxZ: -1.3 },
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
        const onShell = Math.abs(x + 7.92) < 0.1 || Math.abs(z + 5.42) < 0.1;
        const onPartition = Math.abs(Math.abs(x) - 2.5) < 0.15;
        expect(onShell || onPartition, detail.id).toBe(true);
        expect(y + piece.size[1] / 2, detail.id).toBeLessThanOrEqual(onShell ? 1.1 : 0.76);
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
