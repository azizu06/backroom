import { doorway } from './layout';

/** Cosmetic interior doors only. Treasury is deliberately outside this contract. */
export const INTERIOR_DOORS = ['collections', 'payables', 'vendor_onboarding'] as const;
export type DoorId = typeof INTERIOR_DOORS[number];
export type DoorState = Readonly<Record<DoorId, boolean>>;
export const OPEN_DOORS: DoorState = { collections: true, payables: true, vendor_onboarding: true };
export const DOOR_WIDTH = 1.3;
export const DOOR_DEPTH = 0.12;
/** Full-height leaves under the DOOR_OPENING_HEIGHT header (layout). */
export const DOOR_LEAF_HEIGHT = 2.1;
export function doorPosition(room: DoorId): readonly [number, number] {
  return doorway(room).at;
}
export function toggleDoor(state: DoorState, room: DoorId): DoorState {
  return { ...state, [room]: !state[room] };
}
/** Open leaves swing out of the passage; only closed leaves contribute a movement barrier. */
export function doorCollider(state: DoorState, room: DoorId) {
  if (state[room]) return null;
  const [x, z] = doorPosition(room);
  return { minX: x - DOOR_WIDTH / 2, maxX: x + DOOR_WIDTH / 2, minZ: z - DOOR_DEPTH / 2, maxZ: z + DOOR_DEPTH / 2 };
}
/** Constant angular speed, with an exact end and no animation under reduced motion. */
export function doorAngle(current: number, open: boolean, dt: number, reduced: boolean): number {
  const target = open ? -Math.PI / 2 : 0;
  if (reduced) return target;
  const step = Math.max(0, dt) * Math.PI * 2;
  return current + Math.sign(target - current) * Math.min(Math.abs(target - current), step);
}
