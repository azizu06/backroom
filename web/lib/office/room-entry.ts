/** Room labels are view-only; these radii never grant access or affect Play's colliders. */
import { OFFICE_ANCHORS, type AnchorId, type FloorPosition } from './state';

export const ROOM_ENTER_RADIUS = 2.2;
export const ROOM_LEAVE_RADIUS = 2.8;
export const ROOM_ENTRY_MS = 1600;

/** Furniture colliders are not room footprints, so use the shared anchor centres. */
export function roomAt(position: FloorPosition, current: AnchorId | null, rooms: readonly AnchorId[]): AnchorId | null {
  if (!position.every(Number.isFinite)) return null;
  const distance = (room: AnchorId) => Math.hypot(
    position[0] - OFFICE_ANCHORS[room].center[0], position[1] - OFFICE_ANCHORS[room].center[1],
  );
  if (current && rooms.includes(current) && distance(current) <= ROOM_LEAVE_RADIUS) return current;
  let nearest: AnchorId | null = null;
  let reach = ROOM_ENTER_RADIUS;
  for (const room of rooms) {
    const metres = distance(room);
    if (metres < reach) { nearest = room; reach = metres; }
  }
  return nearest;
}
