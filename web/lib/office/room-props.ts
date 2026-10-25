/** Compatibility for the detached partition-dressing mount. No furniture in imaginary rooms. */
import type { SpaceId, Rect } from './layout';
import type { DetailPiece } from './props/roomDetail';
export const ROOM_PROP_GROUPS: readonly { room: SpaceId; pieces: DetailPiece[] }[] = [];
export const roomPropsVisible = (room: SpaceId, rooms: readonly SpaceId[]) => rooms.includes(room);
export function roomPropColliders(_rooms: readonly SpaceId[]): Rect[] { return []; }
