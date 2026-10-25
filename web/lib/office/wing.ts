/** Compatibility for retired wing mounts; the square hall has no private wing or lounge. */
import type { FurniturePiece } from './furniture';
import type { Rect, Vec2 } from './layout';

export interface WingPiece extends FurniturePiece {
  readonly shape: 'box' | 'cylinder' | 'sphere';
  readonly solid?: boolean;
}
export const WORK_DESKS: readonly { x: number; z: number }[] = [];
export const WORK_ROOM_PIECES: readonly WingPiece[] = [];
export const ATRIUM_TREES: readonly Vec2[] = [];
export const ATRIUM_MEZZANINE: readonly WingPiece[] = [];
export const ATRIUM_PIECES: readonly WingPiece[] = [];
export const ATRIUM_SKYLIGHTS: readonly WingPiece[] = [];
export const ATRIUM_ROOF: readonly WingPiece[] = [];
export const WING_COLLIDERS: readonly Rect[] = [];
