/**
 * Furniture for the calm shared spaces (meeting room, break room, server room extras). View-only dressing:
 * no Play target, policy or state. Drawn by web/app/office/mounts/SharedRooms.tsx; the solid ones are
 * listed in SHARED_ROOM_COLLIDERS, which officeColliders always includes.
 */
import type { DetailPiece } from './props/roomDetail';
import type { Rect } from './layout';
import { OUTDOOR, PALETTE, ROLES } from './palette';

const box = (at: DetailPiece['at'], size: DetailPiece['size'], color: string, rotation?: DetailPiece['rotation']): DetailPiece =>
  ({ shape: 'box', at, size, color, ...rotation ? { rotation } : {} });
const cylinder = (at: DetailPiece['at'], size: DetailPiece['size'], color: string): DetailPiece => ({ shape: 'cylinder', at, size, color });
const footprint = (x: number, z: number, width: number, depth: number): Rect =>
  ({ minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 });

const PLANTS = [[6.55, -6.95], [11.45, -6.95], [11.4, 6.85]] as const;
const plants: DetailPiece[] = PLANTS.flatMap(([x, z]) => [
  cylinder([x, 0.2, z], [0.42, 0.4, 0.42], PALETTE.blush),
  cylinder([x, 0.41, z], [0.34, 0.03, 0.34], ROLES.shadow),
  cylinder([x, 0.7, z], [0.05, 0.6, 0.05], ROLES.frame),
  ...[-1, 0, 1].map(side => box([x + side * 0.13, 0.9 + side * 0.1, z], [0.25, 0.45, 0.25], ROLES.plant, [0, 0, side * -0.45])),
]);

/** Meeting room (x 6..12, z -7.5..-1.5): a six-seat table facing a wall screen, and a low credenza. */
const MEETING_TABLE = { x: 9, z: -4.8, width: 3, depth: 1.3 } as const;
const MEETING_CHAIRS = [8, 9, 10].flatMap(x => [-1, 1].map(side => ({ x, z: MEETING_TABLE.z + side * 1.05, side })));
function chair(x: number, z: number, side: number, color: string): DetailPiece[] {
  return [
    box([x, 0.46, z], [0.48, 0.08, 0.48], color),
    box([x, 0.76, z + side * 0.22], [0.48, 0.52, 0.07], color),
    cylinder([x, 0.21, z], [0.07, 0.42, 0.07], ROLES.frame),
    cylinder([x, 0.02, z], [0.4, 0.04, 0.4], ROLES.frame),
  ];
}
const meeting: DetailPiece[] = [
  box([MEETING_TABLE.x, 0.74, MEETING_TABLE.z], [MEETING_TABLE.width, 0.06, MEETING_TABLE.depth], ROLES.desk),
  ...[-1, 1].map(side => box([MEETING_TABLE.x + side * 1.0, 0.36, MEETING_TABLE.z], [0.25, 0.72, 0.8], ROLES.partition)),
  ...MEETING_CHAIRS.flatMap(({ x, z, side }, i) => chair(x, z, side, i % 2 ? PALETTE.lavender : PALETTE.mint)),
  // Wall screen between the two north windows.
  box([9, 1.55, -7.39], [1.8, 1.05, 0.05], ROLES.frame),
  box([9, 1.55, -7.36], [1.68, 0.93, 0.01], OUTDOOR.screen),
  // Whiteboard on the west partition; its drawn face is supplied by SharedRooms.
  box([6.13, 1.65, -4.8], [0.06, 1.1, 2.1], ROLES.frame),
  box([6.17, 1.65, -4.8], [0.02, 1, 2], PALETTE.cream),
  box([6.23, 1.07, -4.8], [0.18, 0.04, 2.1], ROLES.frame),
  // Credenza under the east windows, with a jug and two cups.
  box([11.62, 0.4, -4.5], [0.5, 0.8, 2], ROLES.desk),
  box([11.36, 0.4, -4.5], [0.02, 0.6, 1.8], ROLES.partition),
  cylinder([11.62, 0.92, -4.1], [0.14, 0.24, 0.14], PALETTE.aqua),
  cylinder([11.62, 1.065, -4.1], [0.08, 0.05, 0.08], PALETTE.aqua),
  box([11.62, 0.95, -3.99], [0.04, 0.12, 0.12], ROLES.frame),
  cylinder([11.62, 0.85, -4.6], [0.09, 0.1, 0.09], PALETTE.cream),
  cylinder([11.62, 0.85, -4.85], [0.09, 0.1, 0.09], PALETTE.blush),
];

/** Break room (x 6..12, z 1.5..7.5): a kitchen run on the west wall, a fridge, a round table and a sofa corner. */
const COUNTER = { x: 6.42, z: 4.5, width: 0.68, depth: 3.8 } as const;
const TABLE = { x: 8.6, z: 5.3 } as const;
const STOOLS = [0, 1, 2, 3].map(i => { const a = i * Math.PI / 2 + Math.PI / 4; return [TABLE.x + Math.cos(a) * 0.85, TABLE.z + Math.sin(a) * 0.85] as const; });
const breakRoom: DetailPiece[] = [
  box([COUNTER.x, 0.44, COUNTER.z], [COUNTER.width, 0.88, COUNTER.depth], OUTDOOR.counter),
  box([COUNTER.x + 0.02, 0.905, COUNTER.z], [COUNTER.width + 0.05, 0.05, COUNTER.depth + 0.05], ROLES.desk),
  ...[-1.27, 0, 1.27].map(dz => box([COUNTER.x + 0.345, 0.45, COUNTER.z + dz], [0.01, 0.7, 1.15], ROLES.partition)),
  box([6.3, 2.05, COUNTER.z], [0.4, 0.75, 3.2], ROLES.partition),
  box([6.51, 2.05, COUNTER.z], [0.01, 0.65, 3.1], PALETTE.cream),
  box([COUNTER.x + 0.03, 0.935, 3.5], [0.42, 0.015, 0.55], ROLES.shadow),
  cylinder([COUNTER.x - 0.15, 1.05, 3.5], [0.04, 0.25, 0.04], ROLES.frame),
  box([COUNTER.x - 0.06, 1.17, 3.5], [0.2, 0.04, 0.04], ROLES.frame),
  box([COUNTER.x + 0.03, 0.946, 3.5], [0.32, 0.01, 0.43], PALETTE.aqua),
  box([COUNTER.x, 1.13, 5.6], [0.32, 0.4, 0.3], ROLES.frame),
  box([COUNTER.x + 0.1, 1.0, 5.6], [0.14, 0.03, 0.18], ROLES.shadow),
  cylinder([COUNTER.x + 0.12, 0.98, 5.95], [0.09, 0.1, 0.09], PALETTE.blush),
  cylinder([COUNTER.x, 1.01, 4.6], [0.18, 0.16, 0.18], PALETTE.butter),
  // Fridge in the south-west corner.
  box([6.45, 0.9, 6.95], [0.7, 1.8, 0.7], OUTDOOR.fridge),
  box([6.81, 1.25, 6.75], [0.03, 0.5, 0.04], ROLES.shadow),
  box([6.81, 0.55, 6.75], [0.03, 0.3, 0.04], ROLES.shadow),
  box([6.805, 1.0, 6.95], [0.005, 0.01, 0.68], ROLES.shadow),
  // Round table with four chairs, backs facing away from the table.
  cylinder([TABLE.x, 0.74, TABLE.z], [1.2, 0.05, 1.2], ROLES.desk),
  cylinder([TABLE.x, 0.37, TABLE.z], [0.1, 0.72, 0.1], ROLES.frame),
  cylinder([TABLE.x, 0.02, TABLE.z], [0.55, 0.04, 0.55], ROLES.frame),
  ...STOOLS.flatMap(([x, z], i) => [
    cylinder([x, 0.47, z], [0.38, 0.06, 0.38], [PALETTE.blush, PALETTE.mint, PALETTE.butter, PALETTE.lavender][i]!),
    cylinder([x, 0.22, z], [0.06, 0.44, 0.06], ROLES.frame),
    box([x + (x - TABLE.x) * 0.25, 0.72, z + (z - TABLE.z) * 0.25], [0.38, 0.46, 0.06], PALETTE.lavender,
      [0, -Math.atan2(z - TABLE.z, x - TABLE.x) + Math.PI / 2, 0]),
  ]),
  cylinder([TABLE.x - 0.2, 0.82, TABLE.z + 0.1], [0.1, 0.1, 0.1], PALETTE.aqua),
  box([TABLE.x + 0.15, 0.775, TABLE.z - 0.15], [0.3, 0.02, 0.22], PALETTE.cream),
  // Shallow bowl and low-poly fruit.
  cylinder([TABLE.x, 0.8, TABLE.z], [0.38, 0.08, 0.38], PALETTE.cream),
  ...[PALETTE.coral, PALETTE.butter, PALETTE.mint].map((color, i) => cylinder(
    [TABLE.x + (i - 1) * 0.09, 0.88, TABLE.z + (i % 2) * 0.06], [0.13, 0.13, 0.13], color)),
  // Notice board on the corridor partition, away from the door.
  box([10.5, 1.7, 1.62], [1.5, 0.95, 0.05], ROLES.frame),
  box([10.5, 1.7, 1.655], [1.4, 0.85, 0.02], PALETTE.peach),
  ...[-1, 1].flatMap(side => [
    box([10.5 + side * 0.32, 1.72, 1.675], [0.4, 0.5, 0.01], side < 0 ? PALETTE.butter : PALETTE.mint),
    box([10.5 + side * 0.32, 1.91, 1.685], [0.04, 0.04, 0.01], PALETTE.coral),
    ...[0, 1, 2].map(i => box([10.5 + side * 0.32, 1.8 - i * 0.1, 1.685], [0.26, 0.018, 0.01], ROLES.text)),
  ]),
  // Clock face on the west wall, clear of the kitchen cupboards.
  { ...cylinder([6.13, 2.2, 6.7], [0.55, 0.05, 0.55], ROLES.frame), rotation: [0, 0, Math.PI / 2] },
  { ...cylinder([6.165, 2.2, 6.7], [0.48, 0.02, 0.48], PALETTE.cream), rotation: [0, 0, Math.PI / 2] },
  box([6.18, 2.28, 6.7], [0.01, 0.18, 0.025], ROLES.text),
  box([6.18, 2.2, 6.76], [0.01, 0.025, 0.14], ROLES.text),
  // Pendant cable and shade; the emissive underside is mounted in SharedRooms.
  cylinder([TABLE.x, 2.7, TABLE.z], [0.025, 0.6, 0.025], ROLES.frame),
  cylinder([TABLE.x, 2.36, TABLE.z], [0.55, 0.2, 0.55], PALETTE.butter),
  // Sofa under the east windows, a low coffee table and a rug.
  box([11.5, 0.22, 4.5], [0.78, 0.44, 2.1], OUTDOOR.sofa),
  box([11.82, 0.62, 4.5], [0.16, 0.42, 2.1], OUTDOOR.sofa),
  ...[-1, 1].map(side => box([11.5, 0.5, 4.5 + side * 1.05], [0.78, 0.2, 0.16], OUTDOOR.sofa)),
  ...[-0.5, 0.5].map(dz => box([11.45, 0.47, 4.5 + dz], [0.6, 0.08, 0.9], PALETTE.lavender)),
  box([10.5, 0.21, 4.5], [0.55, 0.42, 1], ROLES.desk),
  box([10.5, 0.425, 4.3], [0.25, 0.02, 0.3], PALETTE.butter),
  box([10.6, 0.006, 4.5], [2.2, 0.008, 2.6], PALETTE.blush),
  box([10.6, 0.011, 4.5], [2.0, 0.004, 2.4], PALETTE.cream),
  // Water cooler by the door.
  box([11.62, 0.5, 1.95], [0.36, 1, 0.36], OUTDOOR.fridge),
  cylinder([11.62, 1.2, 1.95], [0.28, 0.4, 0.28], PALETTE.aqua),
];

/** Server room (x 9.5..12): a UPS cabinet and cable tray beside the GX10 rack. */
const server: DetailPiece[] = [
  box([11.65, 0.35, 0.95], [0.45, 0.7, 0.55], ROLES.frame),
  box([11.65, 0.55, 0.67], [0.3, 0.04, 0.005], ROLES.statusOk),
  box([10.9, 2.7, -0.8], [1.2, 0.06, 0.4], ROLES.shadow),
];

export const SHARED_ROOM_PIECES: readonly DetailPiece[] = [...meeting, ...breakRoom, ...server, ...plants];

export const SHARED_ROOM_COLLIDERS: readonly Rect[] = [
  footprint(MEETING_TABLE.x, MEETING_TABLE.z, MEETING_TABLE.width, MEETING_TABLE.depth),
  ...MEETING_CHAIRS.map(({ x, z }) => footprint(x, z, 0.5, 0.5)),
  footprint(11.62, -4.5, 0.5, 2),
  footprint(COUNTER.x, COUNTER.z, COUNTER.width, COUNTER.depth),
  footprint(6.45, 6.95, 0.7, 0.7),
  footprint(TABLE.x, TABLE.z, 1.2, 1.2),
  ...STOOLS.map(([x, z]) => footprint(x, z, 0.7, 0.7)),
  ...PLANTS.map(([x, z]) => footprint(x, z, 0.5, 0.5)),
  footprint(11.5, 4.5, 0.8, 2.2),
  footprint(10.5, 4.5, 0.55, 1),
  footprint(11.62, 1.95, 0.4, 0.4),
  footprint(11.65, 0.95, 0.45, 0.55),
];
