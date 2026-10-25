import authored from '../../public/office-art/lobby.colliders.json';
import { bakedArtRequested } from './baked-art';
import { propkitColliderBoxes } from './propkit';

/** Footprints baked with the lobby props (`web/public/office-art/lobby.colliders.json`). */
export const LOBBY_COLLIDERS_URL = '/office-art/lobby.colliders.json';

export interface ColliderBox {
  readonly name: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

interface Footprint {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function finite(value: unknown): number {
  const number = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(number) ? number : Number.NaN;
}

/** One authored footprint becomes an axis-aligned collision box on the floor (x, z). */
export function footprintToBox(footprint: { name?: unknown; minX: unknown; maxX: unknown; minZ: unknown; maxZ: unknown }): ColliderBox {
  const name = typeof footprint.name === 'string' && footprint.name ? footprint.name : '';
  const box = {
    name,
    minX: finite(footprint.minX),
    maxX: finite(footprint.maxX),
    minZ: finite(footprint.minZ),
    maxZ: finite(footprint.maxZ),
  };
  if (!box.name) throw new Error('lobby collider is missing a name');
  if (![box.minX, box.maxX, box.minZ, box.maxZ].every(Number.isFinite)) throw new Error(`lobby collider ${box.name} has a non-finite edge`);
  if (box.minX >= box.maxX || box.minZ >= box.maxZ) throw new Error(`lobby collider ${box.name} is empty`);
  return box;
}

/** Parses the bake file. `room` must be the lobby when it is present. */
export function parseLobbyColliders(data: unknown): ColliderBox[] {
  if (!data || typeof data !== 'object') throw new Error('lobby colliders must be an object');
  const record = data as { room?: unknown; boxes?: unknown };
  if (record.room !== undefined && record.room !== 'lobby') throw new Error('lobby colliders are for the lobby');
  if (!Array.isArray(record.boxes)) throw new Error('lobby colliders need a boxes array');
  return record.boxes.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`lobby collider ${index} is not an object`);
    const row = entry as { name?: unknown; minX?: unknown; maxX?: unknown; minZ?: unknown; maxZ?: unknown };
    return footprintToBox({ name: row.name ?? `box-${index}`, minX: row.minX, maxX: row.maxX, minZ: row.minZ, maxZ: row.maxZ });
  });
}

/**
 * Collision extras for Play. Without baked art the base list is returned unchanged
 * (the server-room box today). The lobby follows readiness; the prop kit follows
 * the URL flag because its procedural fallback always occupies the same footprints.
 */
export function lobbyCollisionExtras<T extends Footprint>(baked: boolean, lobby: readonly T[], base: readonly T[], search = ''): (T | ColliderBox)[] {
  return [...base, ...(baked ? lobby : []), ...(bakedArtRequested(search) ? PROPKIT_PROP_BOXES : [])];
}

/** Bundled layout-derived boxes: never wait for a GLB or a fetch. */
export const PROPKIT_PROP_BOXES: readonly ColliderBox[] = propkitColliderBoxes();

/** Parsed at module load from the bake file. Play appends these only when `?art=baked` is set. */
export const LOBBY_PROP_BOXES: readonly ColliderBox[] = parseLobbyColliders(authored);

/** Parses `data` as the lobby collider document. `read` exists so tests can supply the file body. */
export function loadLobbyColliderBoxes(read: (url: string) => Promise<unknown> = async () => authored): Promise<ColliderBox[]> {
  return read(LOBBY_COLLIDERS_URL).then(parseLobbyColliders);
}
