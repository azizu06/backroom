import type { FurniturePiece } from '../furniture';
import { PALETTE, ROLES } from '../palette';
import { OFFICE_ANCHORS, type AnchorId } from '../state';
import { DESKS } from '../targets/desk';
import { DRESSING, SHELF_HEIGHT } from './dressing';

export interface DetailPiece extends FurniturePiece { shape: 'box' | 'cylinder' }
export interface RoomDetailItem {
  id: string;
  room: AnchorId;
  kind: 'rug' | 'art' | 'plant' | 'mug' | 'papers' | 'books' | 'lamp';
  pieces: readonly DetailPiece[];
}

const box = (at: FurniturePiece['at'], size: FurniturePiece['size'], color: string): DetailPiece =>
  ({ shape: 'box', at, size, color });
// Both primitives have unit bounds; the cylinder has radius .5 and height 1 (eight sides in the mount).
const cylinder = (at: FurniturePiece['at'], size: FurniturePiece['size'], color: string): DetailPiece =>
  ({ shape: 'cylinder', at, size, color });
const item = (room: AnchorId, kind: RoomDetailItem['kind'], pieces: DetailPiece[]): RoomDetailItem =>
  ({ id: `${room}:${kind}`, room, kind, pieces });

function rug(room: AnchorId, x: number, z: number, width: number, depth: number, color: string) {
  return item(room, 'rug', [
    box([x, 0.05, z], [width, 0.008, depth], color),
    box([x, 0.056, z], [width - 0.12, 0.004, depth - 0.12], PALETTE.cream),
    ...[-1, 1].map(side => box([x, 0.06, z + side * (depth / 2 - 0.15)], [width - 0.2, 0.004, 0.035], color)),
  ]);
}

/** Small geometric landscape, attached to an existing wall/partition below its top. No text texture. */
function art(room: AnchorId, x: number, y: number, z: number, turn: number, color: string) {
  const cos = Math.cos(turn), sin = Math.sin(turn);
  const local = [
    box([0, 0, 0], [0.8, 0.5, 0.04], ROLES.frame),
    box([0, 0, 0.026], [0.72, 0.42, 0.008], PALETTE.butter),
    box([0.18, 0.09, 0.032], [0.1, 0.1, 0.004], PALETTE.peach),
    box([-0.12, -0.08, 0.034], [0.46, 0.15, 0.004], color),
    box([0.18, -0.14, 0.038], [0.32, 0.1, 0.004], PALETTE.mint),
  ];
  return item(room, 'art', local.map(piece => ({ ...piece,
    at: [x + piece.at[0] * cos + piece.at[2] * sin, y + piece.at[1], z - piece.at[0] * sin + piece.at[2] * cos],
    rotation: [0, turn, 0],
  })));
}

function plant(room: AnchorId, x: number, base: number, z: number): RoomDetailItem {
  return item(room, 'plant', [
    cylinder([x, base + 0.07, z], [0.2, 0.14, 0.2], PALETTE.blush),
    cylinder([x, base + 0.142, z], [0.16, 0.008, 0.16], ROLES.shadow),
    cylinder([x, base + 0.21, z], [0.04, 0.14, 0.04], ROLES.plant),
    box([x - 0.055, base + 0.22, z], [0.1, 0.05, 0.08], PALETTE.mint),
    box([x + 0.045, base + 0.27, z], [0.09, 0.05, 0.08], PALETTE.aqua),
  ]);
}

function clutter(room: typeof DESKS[number]): RoomDetailItem[] {
  const [cx, cz] = OFFICE_ANCHORS[room].center;
  const flip = room === 'dana' ? -1 : 1;
  const local = (kind: RoomDetailItem['kind'], pieces: DetailPiece[]) => item(room, kind, pieces.map(piece => ({ ...piece,
    at: [cx + flip * piece.at[0], piece.at[1], cz + flip * piece.at[2]], rotation: [0, room === 'dana' ? Math.PI : 0, 0],
  })));
  // Front-left clutter leaves the enlarged monitor, keyboard, rear plant and Collections phone clear.
  return [
    local('mug', [
      cylinder([-0.86, 0.99, 0.26], [0.16, 0.16, 0.16], PALETTE.aqua),
      cylinder([-0.86, 1.072, 0.26], [0.12, 0.006, 0.12], ROLES.shadow),
      box([-0.97, 1.01, 0.26], [0.07, 0.025, 0.035], PALETTE.aqua),
      box([-0.97, 0.95, 0.26], [0.07, 0.025, 0.035], PALETTE.aqua),
      box([-1.0, 0.98, 0.26], [0.025, 0.06, 0.035], PALETTE.aqua),
    ]),
    local('papers', [
      box([-0.4, 0.93, 0.28], [0.37, 0.04, 0.28], PALETTE.cream),
      box([-0.38, 0.955, 0.29], [0.37, 0.01, 0.28], PALETTE.butter),
      box([-0.42, 0.962, 0.29], [0.21, 0.004, 0.025], ROLES.shadow),
    ]),
    local('books', [
      box([0.13, 0.935, 0.3], [0.31, 0.05, 0.26], PALETTE.lavender),
      box([0.12, 0.97, 0.3], [0.29, 0.02, 0.23], PALETTE.cream),
      box([0.14, 0.995, 0.3], [0.31, 0.03, 0.26], PALETTE.coral),
    ]),
    local('lamp', [
      cylinder([-1, 0.925, -0.42], [0.19, 0.03, 0.19], PALETTE.lavender),
      cylinder([-1, 1.09, -0.42], [0.025, 0.3, 0.025], ROLES.frame),
      cylinder([-1, 1.25, -0.42], [0.19, 0.1, 0.19], PALETTE.butter),
    ]),
  ];
}

/**
 * View-only dressing: flat rugs, wall-mounted art and objects on existing solid furniture.
 * No new floor obstacle or Play target, collider hook, light, texture or animation is needed.
 */
export const ROOM_DETAILS: readonly RoomDetailItem[] = [
  rug('lobby', -6.7, 2.55, 0.85, 1.2, PALETTE.aqua),
  rug('collections', -3.4, -3.1, 0.65, 1.2, PALETTE.mint),
  rug('payables', 1.6, -3.1, 0.65, 1.2, PALETTE.butter),
  rug('vendor_onboarding', 6.6, -3.1, 0.65, 1.2, PALETTE.lavender),
  rug('dana', 1.55, 2.15, 0.65, 0.75, PALETTE.blush),
  rug('treasury', 6.8, 3, 0.95, 1.2, PALETTE.aqua),
  art('lobby', -7.87, 0.78, 3.05, Math.PI / 2, PALETTE.lavender),
  art('collections', -6.1, 0.78, -5.37, 0, PALETTE.mint),
  // Payables' back wall already carries the interactive whiteboard.
  art('payables', -2.4, 0.46, -1.95, Math.PI / 2, PALETTE.aqua),
  art('vendor_onboarding', 5.9, 0.78, -5.37, 0, PALETTE.lavender),
  art('dana', -2.4, 0.46, 3.5, Math.PI / 2, PALETTE.blush),
  art('treasury', 2.6, 0.46, 3.1, Math.PI / 2, PALETTE.aqua),
  ...DESKS.flatMap(clutter),
  // Shelf tops are empty. Keep the entire plant inside each existing shelf collider.
  ...DRESSING.shelves.map(shelf => plant(shelf.room, shelf.x, SHELF_HEIGHT, shelf.z)),
  plant('dana', -0.92, 0.91, 3.8),
  plant('treasury', 5.62, 1.4, 4.3),
];

/** Stable ordering keeps batch transforms unchanged when only live snapshot data changes. */
export function roomDetailsInRooms(rooms: readonly AnchorId[]): readonly RoomDetailItem[] {
  return ROOM_DETAILS.filter(detail => rooms.includes(detail.room));
}
