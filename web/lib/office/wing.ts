/** West-wing furniture and roof data: the mounts and Play use the same pieces. */
import type { FurniturePiece } from './furniture';
import { ATRIUM_HEIGHT, SPACES, type Rect } from './layout';
import { OUTDOOR, PALETTE, ROLES } from './palette';

export interface WingPiece extends FurniturePiece {
  readonly shape: 'box' | 'cylinder' | 'sphere';
  readonly solid?: boolean;
}
const box = (at: FurniturePiece['at'], size: FurniturePiece['size'], color: string, solid = false): WingPiece =>
  ({ at, size, color, shape: 'box', solid });
const cylinder = (at: FurniturePiece['at'], size: FurniturePiece['size'], color: string, solid = false): WingPiece =>
  ({ at, size, color, shape: 'cylinder', solid });

const work = SPACES.work_room.rect;
/** Two clusters, each with two pairs of facing desks. The centre aisle reaches the printer. */
export const WORK_DESKS = [-21.5, -14.5].flatMap(x => [-0.85, 0.85].flatMap(dx => [4.15, 5.35].map(z => ({ x: x + dx, z }))));
export const WORK_ROOM_PIECES: readonly WingPiece[] = [
  ...WORK_DESKS.flatMap(({ x, z }): WingPiece[] => {
    const facing = z < 5 ? -1 : 1;
    return [
      box([x, 0.76, z], [1.5, 0.09, 1.05], ROLES.desk, true),
      ...[-0.58, 0.58].flatMap(dx => [-0.38, 0.38].map(dz => box([x + dx, 0.38, z + dz], [0.07, 0.72, 0.07], ROLES.frame))),
      box([x, 0.45, z + facing * 0.82], [0.5, 0.12, 0.5], PALETTE.lavender, true),
      box([x, 0.72, z + facing * 1.03], [0.5, 0.5, 0.07], PALETTE.lavender),
      box([x, 1.12, z - facing * 0.23], [0.6, 0.4, 0.06], ROLES.frame),
      box([x, 1.12, z - facing * 0.27], [0.52, 0.32, 0.02], ROLES.screenGlow),
      box([x + 0.5, 0.84, z], [0.21, 0.05, 0.21], ROLES.frame),
      box([x + 0.5, 1.03, z], [0.035, 0.35, 0.035], ROLES.frame),
      box([x + 0.4, 1.23, z], [0.3, 0.08, 0.2], ROLES.lampLight),
    ];
  }),
  // Printer station faces the clear middle aisle.
  box([-18, 0.45, work.maxZ - 0.55], [1.7, 0.9, 0.65], OUTDOOR.counter, true),
  box([-18, 1.12, work.maxZ - 0.55], [0.85, 0.45, 0.55], OUTDOOR.fridge),
  box([-18, 1.36, work.maxZ - 0.55], [0.62, 0.035, 0.4], ROLES.frame),
  box([-18, 1.03, work.maxZ - 0.2], [0.5, 0.05, 0.2], PALETTE.cream),
];

const hall = SPACES.atrium.rect;
export const ATRIUM_TREES = [
  [hall.minX + 1.5, hall.minZ + 1.5], [hall.maxX - 1.5, hall.minZ + 1.5],
  [hall.minX + 1.5, hall.maxZ - 1.5],
] as const;
export const ATRIUM_PIECES: readonly WingPiece[] = [
  ...ATRIUM_TREES.flatMap(([x, z]): WingPiece[] => [
    cylinder([x, 0.45, z], [1.4, 0.9, 1.4], PALETTE.peach, true),
    cylinder([x, 0.91, z], [1.22, 0.04, 1.22], ROLES.shadow),
    cylinder([x, 2.1, z], [0.26, 2.4, 0.26], OUTDOOR.trunk),
    { shape: 'sphere', at: [x, 3.65, z], size: [2.2, 2.5, 2.2], color: ROLES.plant },
    { shape: 'sphere', at: [x + 0.6, 3.3, z - 0.25], size: [1.5, 1.7, 1.5], color: PALETTE.mint },
  ]),
  // Seating island stays north of the corridor-to-work-room route.
  box([-18, 0.06, -3.2], [5.4, 0.025, 3.5], PALETTE.blush),
  ...[-20, -16].flatMap(x => [
    box([x, 0.35, -3.2], [0.85, 0.6, 2.5], OUTDOOR.sofa, true),
    box([x + (x < -18 ? -0.35 : 0.35), 0.85, -3.2], [0.18, 0.75, 2.5], PALETTE.lavender),
  ]),
  cylinder([-18, 0.4, -3.2], [1.3, 0.7, 1.3], ROLES.desk, true),
  // A visual-only mezzanine, 3.5 m up, along the north side. No stair or walkable floor.
  box([-18, 3.5, -6.6], [11.7, 0.22, 1.5], ROLES.desk),
  box([-18, 4.6, -5.85], [11.7, 0.09, 0.09], ROLES.frame),
  ...Array.from({ length: 13 }, (_, i) => box([-23.6 + i * 0.93, 4.1, -5.85], [0.05, 1, 0.05], ROLES.frame)),
  ...[-23.5, -12.5].map(x => box([x, 1.7, -6.6], [0.2, 3.4, 0.2], ROLES.frame)),
];

/** Two genuine roof openings, each 3 x 6 m, filled by tinted skylight panes. */
export const ATRIUM_SKYLIGHTS: readonly WingPiece[] = [-20.5, -15.5].map(x => box([x, ATRIUM_HEIGHT + 0.06, -2.5], [3, 0.06, 6], OUTDOOR.glass));
export const ATRIUM_ROOF: readonly WingPiece[] = [
  ...[-6.5, 1.5].map(z => box([-18, ATRIUM_HEIGHT + 0.06, z], [12.16, 0.12, 2], ROLES.ceiling)),
  ...[[-23, 2], [-18, 2], [-13, 2]].map(([x, width]) => box([x!, ATRIUM_HEIGHT + 0.06, -2.5], [width!, 0.12, 6], ROLES.ceiling)),
  // Close the upper wall above the original office's 3 m ceiling.
  box([hall.maxX, 5, -2.5], [0.16, 4, 10], ROLES.wall),
  ...ATRIUM_SKYLIGHTS.flatMap(piece => {
    const [x, , z] = piece.at;
    return [
      ...[-1.5, 1.5].map(dx => box([x + dx, ATRIUM_HEIGHT, z], [0.08, 0.16, 6.1], OUTDOOR.windowFrame)),
      ...[-3, 0, 3].map(dz => box([x, ATRIUM_HEIGHT, z + dz], [3, 0.16, 0.08], OUTDOOR.windowFrame)),
    ];
  }),
];

export const WING_COLLIDERS: readonly Rect[] = [...WORK_ROOM_PIECES, ...ATRIUM_PIECES].filter(piece => piece.solid).map(piece => ({
  minX: piece.at[0] - piece.size[0] / 2, maxX: piece.at[0] + piece.size[0] / 2,
  minZ: piece.at[2] - piece.size[2] / 2, maxZ: piece.at[2] + piece.size[2] / 2,
}));
