/**
 * Pure "where am I" for first-person audio: the player's space (from the shared room anchors, with the
 * same hysteresis as the room-entry label), its floor and its ambience mix. View only: these never grant
 * access, move colliders or touch office state.
 */
import { roomAt } from '../room-entry';
import { FLOOR } from '../play';
import { spaceAt as layoutSpaceAt, type SpaceId } from '../layout';
import type { AnchorId, FloorPosition } from '../state';
import type { FloorType } from './footsteps';

export type Space = 'lobby' | 'work' | 'break' | 'vault' | 'aisle' | 'outdoor';
export type AmbienceLayer = 'hum' | 'murmur' | 'keys' | 'birds';
export type AmbienceMix = Readonly<Record<AmbienceLayer, number>>;
export const AMBIENCE_LAYERS: readonly AmbienceLayer[] = ['hum', 'murmur', 'keys', 'birds'];

/** The three agent rooms are work rooms; the open commons around Dana's desk is the break area. */
export const ROOM_SPACES: Readonly<Record<AnchorId, Space>> = {
  lobby: 'lobby', collections: 'work', payables: 'work', vendor_onboarding: 'work', dana: 'break', treasury: 'vault',
};
export const SPACE_FLOORS: Readonly<Record<Space, FloorType>> = {
  lobby: 'tile', work: 'carpet', break: 'wood', vault: 'tile', aisle: 'wood', outdoor: 'grass',
};
/** Layer levels 0..1 per space: lobby hum, break-room murmur, keyboard ticks in work rooms, birds outdoors. */
export const SPACE_AMBIENCE: Readonly<Record<Space, AmbienceMix>> = {
  lobby: { hum: 0.9, murmur: 0.25, keys: 0, birds: 0 },
  work: { hum: 0.35, murmur: 0.12, keys: 0.85, birds: 0 },
  break: { hum: 0.3, murmur: 0.85, keys: 0.08, birds: 0 },
  vault: { hum: 0.6, murmur: 0, keys: 0, birds: 0 },
  aisle: { hum: 0.5, murmur: 0.3, keys: 0.2, birds: 0 },
  outdoor: { hum: 0, murmur: 0, keys: 0, birds: 1 },
};
/** The front (+z) wall is glazed; birds fade in over the last `WINDOW_REACH` metres before it. */
export const WINDOW_Z = FLOOR.maxZ;
export const WINDOW_REACH = 1.6;
/** Bird level right at the window, below being outdoors. */
export const WINDOW_BIRDS = 0.7;

export function spaceForRoom(room: AnchorId | null): Space { return room ? ROOM_SPACES[room] : 'aisle'; }
/** Rooms with no desk agent (./layout) and how they sound. */
const SHARED_SPACES: Partial<Record<SpaceId, Space>> = { meeting: 'work', work_room: 'work', break_room: 'break', atrium: 'lobby', server_room: 'vault' };
export function floorFor(space: Space): FloorType { return SPACE_FLOORS[space]; }

function outside([x, z]: FloorPosition) { return x < FLOOR.minX || x > FLOOR.maxX || z < FLOOR.minZ || z > FLOOR.maxZ; }

/** 0 away from the windows, 1 at the glass (and outdoors). */
export function windowNearness(position: FloorPosition): number {
  if (!position.every(Number.isFinite)) return 0;
  if (outside(position)) return 1;
  return Math.min(1, Math.max(0, 1 - (WINDOW_Z - position[1]) / WINDOW_REACH));
}

export interface SpaceReading { readonly room: AnchorId | null; readonly space: Space }
/** The room (with hysteresis from `current`) and space at a floor position; off the floor is outdoors. */
export function spaceAt(position: FloorPosition, current: AnchorId | null, rooms: readonly AnchorId[]): SpaceReading {
  if (position.every(Number.isFinite) && outside(position)) return { room: null, space: 'outdoor' };
  const room = roomAt(position, current, rooms);
  const shared = room ? undefined : SHARED_SPACES[layoutSpaceAt(position) ?? 'corridor'];
  return { room, space: shared ?? spaceForRoom(room) };
}

/** One layer's target level: the space's mix, with birds raised near the windows. */
export function ambienceLevel(space: Space, layer: AmbienceLayer, nearWindow = 0): number {
  const base = SPACE_AMBIENCE[space][layer];
  if (layer !== 'birds') return base;
  const near = Number.isFinite(nearWindow) ? Math.min(1, Math.max(0, nearWindow)) : 0;
  return Math.max(base, near * WINDOW_BIRDS);
}
