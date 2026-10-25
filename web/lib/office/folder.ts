import { OFFICE_ANCHORS, type AnchorId, type FloorPosition } from './state';
import { DESKS, DESK_SIZE } from './targets/desk';
import { BUILDING, LOBBY_KIOSK } from './layout';

export interface FolderSpot { readonly position: readonly [number, number, number]; readonly room: AnchorId | null }
/** null means held. This prop is unrelated to the agents' policy/escalation folders. */
export type FolderState = FolderSpot | null;
const KIOSK = LOBBY_KIOSK;
export const INITIAL_FOLDER: FolderSpot = { position: [KIOSK[0], 0.8, KIOSK[1] + 0.3], room: 'lobby' };
export const FOLDER_RADIUS = 0.24;
export function pickUpFolder(): FolderState { return null; }

/** Nearest tabletop intersecting the forward reach; otherwise the floor a short step ahead. */
export function putDownFolder(eye: FloorPosition, yaw: number, rooms: readonly AnchorId[]): FolderSpot {
  const forward = [-Math.sin(yaw), -Math.cos(yaw)] as const;
  const surfaces = [
    ...(rooms.includes('lobby') ? [{ x: KIOSK[0], z: KIOSK[1], width: 0.8, depth: 1, y: 0.8, room: 'lobby' as const }] : []),
    ...DESKS.filter(room => rooms.includes(room)).map(room => ({
      x: OFFICE_ANCHORS[room].center[0], z: OFFICE_ANCHORS[room].center[1],
      ...DESK_SIZE, y: 0.93, room,
    })),
  ];
  // Keep the whole folder on a surface, not balanced over its edge.
  for (let distance = 0.35; distance <= 1.25; distance += 0.025) {
    const x = eye[0] + forward[0] * distance, z = eye[1] + forward[1] * distance;
    const surface = surfaces.find(s => Math.abs(x - s.x) <= s.width / 2 - 0.15 && Math.abs(z - s.z) <= s.depth / 2 - 0.19);
    if (surface) return { position: [x, surface.y, z], room: surface.room };
  }
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  return { position: [clamp(eye[0] + forward[0] * 0.8, BUILDING.minX + 0.2, BUILDING.maxX - 0.2), 0.025, clamp(eye[1] + forward[1] * 0.8, BUILDING.minZ + 0.2, BUILDING.maxZ - 0.2)], room: null };
}

/** World targets always take priority over the held item's fallback action. */
export function interactionLabel(targetLabel: string | null, folder: FolderState): string | null {
  return targetLabel || (folder === null ? 'Put down folder' : null);
}
