/**
 * The grounds around the building as data (drawn by web/app/office/mounts/Outdoors.tsx): a seeded scatter
 * of low-poly trees and bushes, the entrance path and a ring of distant hills. Pure and deterministic, so
 * every viewer sees the same grounds and tests can check nothing grows inside the building or on the path.
 */
import { BUILDING, doorway, type Rect } from './layout';
import { OFFICE_LIGHTING } from './lighting';

export interface TreeSpot { readonly x: number; readonly z: number; readonly height: number; readonly radius: number; readonly kind: 'pine' | 'round'; readonly tint: 0 | 1 }
export interface BushSpot { readonly x: number; readonly z: number; readonly size: number; readonly tint: 0 | 1 }
export interface HillSpot { readonly x: number; readonly z: number; readonly width: number; readonly height: number; readonly far: boolean }

const ENTRANCE = doorway('entrance').at;
/** Walk from the street to the lobby's south door. */
export const PATH: Rect = { minX: ENTRANCE[0] - 0.9, maxX: ENTRANCE[0] + 0.9, minZ: BUILDING.maxZ, maxZ: 34 };
/** Paved apron in front of the entrance. */
export const PLAZA: Rect = { minX: ENTRANCE[0] - 2.2, maxX: ENTRANCE[0] + 2.2, minZ: BUILDING.maxZ, maxZ: BUILDING.maxZ + 2.2 };
export const GRASS_RADIUS = 150;

/** Unit vector toward the sun: the key light's direction (it shines from its position toward the origin). */
export const SUN_DIRECTION: readonly [number, number, number] = (() => {
  const [x, y, z] = OFFICE_LIGHTING.key.position;
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
})();
export const SUN_DISTANCE = 300;

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inflate = (rect: Rect, by: number): Rect => ({ minX: rect.minX - by, maxX: rect.maxX + by, minZ: rect.minZ - by, maxZ: rect.maxZ + by });
const inside = (rect: Rect, x: number, z: number) => x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;

/** True when a plant of `radius` at (x, z) stays off the building (plus `clearance`), the path and the plaza. */
export function groundClear(x: number, z: number, radius: number, clearance: number): boolean {
  return !inside(inflate(BUILDING, clearance + radius), x, z) && !inside(inflate(PATH, 0.6 + radius), x, z) && !inside(inflate(PLAZA, 0.4 + radius), x, z);
}

/**
 * Trees on a ring around the building. The overview camera looks from the south-east, so trees on the
 * south and east sides keep further back and never hide the floor plan.
 */
function scatterTrees(): TreeSpot[] {
  const random = rng(20261025);
  const trees: TreeSpot[] = [];
  for (let tries = 0; trees.length < 72 && tries < 4000; tries++) {
    const angle = random() * Math.PI * 2, distance = 16 + random() * 40;
    const x = Math.cos(angle) * distance, z = Math.sin(angle) * distance * 0.8;
    const kind = random() < 0.45 ? 'pine' : 'round';
    const height = kind === 'pine' ? 4 + random() * 3 : 3.2 + random() * 2.2;
    const radius = kind === 'pine' ? 1 + random() * 0.5 : 1.3 + random() * 0.7;
    const nearSide = x > BUILDING.maxX - 4 || z > BUILDING.maxZ - 2;
    if (!groundClear(x, z, radius, nearSide ? 9 : 4)) continue;
    if (trees.some(tree => Math.hypot(tree.x - x, tree.z - z) < tree.radius + radius + 0.6)) continue;
    trees.push({ x, z, height, radius, kind, tint: random() < 0.5 ? 0 : 1 });
  }
  return trees;
}

/** Bushes hug the foundation (clear of the windows' view and the entrance) and line the path. */
function scatterBushes(): BushSpot[] {
  const random = rng(4242);
  const bushes: BushSpot[] = [];
  const add = (x: number, z: number, size: number) => {
    if (groundClear(x, z, size * 0.5, 0.5) && !bushes.some(bush => Math.hypot(bush.x - x, bush.z - z) < (bush.size + size) * 0.45)) {
      bushes.push({ x, z, size, tint: random() < 0.5 ? 0 : 1 });
    }
  };
  for (let x = BUILDING.minX + 0.8; x < BUILDING.maxX; x += 1.7 + random()) add(x, BUILDING.maxZ + 1.3, 0.6 + random() * 0.35);
  for (let x = BUILDING.minX + 0.5; x < BUILDING.maxX; x += 1.9 + random()) add(x, BUILDING.minZ - 1.3, 0.7 + random() * 0.4);
  for (let z = BUILDING.minZ + 0.6; z < BUILDING.maxZ; z += 1.8 + random()) {
    add(BUILDING.minX - 1.3, z, 0.7 + random() * 0.4);
    add(BUILDING.maxX + 1.3, z, 0.6 + random() * 0.35);
  }
  for (let z = BUILDING.maxZ + 3.5; z < PATH.maxZ; z += 2.6 + random()) {
    add(PATH.minX - 1.4, z, 0.6 + random() * 0.3);
    add(PATH.maxX + 1.4, z + 1.2, 0.6 + random() * 0.3);
  }
  for (let i = 0; i < 40; i++) {
    const angle = random() * Math.PI * 2, distance = 15 + random() * 35;
    add(Math.cos(angle) * distance, Math.sin(angle) * distance * 0.8, 0.8 + random() * 0.6);
  }
  return bushes;
}

/** Two rings of low, wide hills on the horizon; the far ring is hazier. */
function hillRing(): HillSpot[] {
  const random = rng(77);
  const hills: HillSpot[] = [];
  for (const [count, distance, far] of [[18, 120, false], [22, 175, true]] as const) {
    for (let i = 0; i < count; i++) {
      const angle = (i + random() * 0.6) / count * Math.PI * 2;
      const d = distance + random() * 25;
      hills.push({ x: Math.cos(angle) * d, z: Math.sin(angle) * d, width: 35 + random() * 35, height: (far ? 14 : 9) + random() * 10, far });
    }
  }
  return hills;
}

export const TREES: readonly TreeSpot[] = scatterTrees();
export const BUSHES: readonly BushSpot[] = scatterBushes();
export const HILLS: readonly HillSpot[] = hillRing();
