import {
  BUILDING, DOORWAYS, WINDOWS, WORKSTATIONS, WALL_THICKNESS, LOBBY_BOARD_MOUNT,
  type Rect, type Doorway, type WindowSpec,
} from './layout';
import { PLANT_SPOTS, workstationPieces } from './furniture';
import { PALETTE } from './palette';
import { SERVER_ROOM } from './targets/server';
import { AUDIT_WALL } from './props/auditWall';

export const PROPKIT_GLB_URL = '/office-art/propkit.glb';
/** Local envelopes shared with tools/bake/propkit.py. Origin: floor centre; front: +z. */
export const PROPKIT_SPECS = {
  plant_tall: { size: [0.8, 1.65, 0.8], solid: true },
  plant_small: { size: [0.5, 0.85, 0.5], solid: true },
  bookshelf: { size: [1.1, 1.8, 0.42], solid: true },
  water_cooler: { size: [0.55, 1.5, 0.55], solid: true },
  coffee_station: { size: [1.1, 1.45, 0.6], solid: true },
  wall_art_a: { size: [1.1, 0.8, 0.08], solid: false },
  wall_art_b: { size: [0.8, 1.0, 0.08], solid: false },
  floor_lamp: { size: [0.5, 1.9, 0.5], solid: true },
  pendant_lamp: { size: [0.65, 0.7, 0.65], solid: false },
  rug_large: { size: [1, 0.012, 1], solid: false },
  office_tv: { size: [1.5, 0.9, 0.12], solid: false },
  arcade: { size: [0.8, 1.75, 0.8], solid: true },
} as const;
export type PropKitNode = keyof typeof PROPKIT_SPECS;
export const PROPKIT_NODES = Object.keys(PROPKIT_SPECS) as PropKitNode[];
export interface PropPlacement {
  id: string;
  node: PropKitNode;
  position: [number, number, number];
  rotation: number;
  scale?: [number, number, number];
}
export interface PropKitLayout {
  building: Rect;
  windows: readonly Pick<WindowSpec, 'wall' | 'at' | 'width'>[];
  doorways: readonly Pick<Doorway, 'id' | 'kind' | 'axis' | 'at' | 'width'>[];
  pods: readonly (Rect & { id: string })[];
  /** Existing furniture / wall displays, kept clear even if their owning mount is not ready. */
  occupied?: readonly Rect[];
}
const rect = (x: number, z: number, w: number, d: number): Rect =>
  ({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
export const propRectsOverlap = (a: Rect, b: Rect, gap = 0): boolean =>
  a.minX < b.maxX + gap && a.maxX > b.minX - gap && a.minZ < b.maxZ + gap && a.maxZ > b.minZ - gap;

/** Pod boxes enclose desks AND chairs, derived from the same furniture as the scene. */
export function currentPropKitLayout(): PropKitLayout {
  const pods = [...new Set(WORKSTATIONS.map(seat => seat.pod))].map(pod => {
    const pieces = WORKSTATIONS.filter(seat => seat.pod === pod)
      .flatMap(seat => workstationPieces(seat.center, seat.flip, PALETTE.peach));
    return { id: `pod-${pod}`,
      minX: Math.min(...pieces.map(p => p.at[0] - p.size[0] / 2)),
      maxX: Math.max(...pieces.map(p => p.at[0] + p.size[0] / 2)),
      minZ: Math.min(...pieces.map(p => p.at[2] - p.size[2] / 2)),
      maxZ: Math.max(...pieces.map(p => p.at[2] + p.size[2] / 2)),
    };
  });
  return { building: BUILDING, windows: WINDOWS, doorways: DOORWAYS, pods, occupied: [
    ...PLANT_SPOTS.map(([x, z]) => rect(x, z, 1, 1)),
    rect(SERVER_ROOM.position[0], SERVER_ROOM.position[1], SERVER_ROOM.size.width, SERVER_ROOM.size.depth),
    rect(LOBBY_BOARD_MOUNT.x, LOBBY_BOARD_MOUNT.z, LOBBY_BOARD_MOUNT.width, 0.3),
    rect(AUDIT_WALL.x, AUDIT_WALL.z, 0.3, AUDIT_WALL.width),
  ] };
}

/** Rotation-aware world envelope, used for placement, fallback geometry tests and collision. */
export function propPlacementFootprint(p: PropPlacement): Rect {
  const [w, , d] = PROPKIT_SPECS[p.node].size;
  const sx = p.scale?.[0] ?? 1, sz = p.scale?.[2] ?? 1;
  const c = Math.abs(Math.cos(p.rotation)), s = Math.abs(Math.sin(p.rotation));
  return rect(p.position[0], p.position[2], w * sx * c + d * sz * s, w * sx * s + d * sz * c);
}

/** Full opening plus 1.2 m on every side, not just distance from the door centre. */
export function propDoorClearance(door: PropKitLayout['doorways'][number]): Rect {
  return rect(door.at[0], door.at[1], 2.4 + (door.axis === 'x' ? door.width : 0),
    2.4 + (door.axis === 'z' ? door.width : 0));
}

/** Reserve a one-metre strip in front of each window (including its frame). */
export function propWindowClearance(window: PropKitLayout['windows'][number], b: Rect): Rect {
  const span = window.width + 0.12;
  switch (window.wall) {
    case 'west': return rect(b.minX + 0.45, window.at, 1.1, span);
    case 'east': return rect(b.maxX - 0.45, window.at, 1.1, span);
    case 'north': return rect(window.at, b.minZ + 0.45, span, 1.1);
    case 'south': return rect(window.at, b.maxZ - 0.45, span, 1.1);
    default: return rect(0, 0, 0, 0); // obsolete interior glazing has no perimeter footprint
  }
}

type Wall = 'north' | 'south' | 'east' | 'west';
/** Deterministic, room-relative dressing. Rugs alone deliberately sit beneath pod boxes and are non-solid. */
export function propkitPlacements(layout: PropKitLayout): PropPlacement[] {
  const b = layout.building, out: PropPlacement[] = [];
  const margin = WALL_THICKNESS / 2 + 0.08;
  const forbidden = [...layout.pods, ...(layout.occupied ?? []),
    ...layout.doorways.map(propDoorClearance), ...layout.windows.map(w => propWindowClearance(w, b))];
  const centreX = (b.minX + b.maxX) / 2;
  const board = rect(centreX, b.minZ + 0.4, 6, 0.8);
  const clear = (p: PropPlacement): boolean => {
    const f = propPlacementFootprint(p);
    if (f.minX < b.minX + margin || f.maxX > b.maxX - margin ||
        f.minZ < b.minZ + margin || f.maxZ > b.maxZ - margin) return false;
    if (forbidden.some(r => propRectsOverlap(f, r))) return false;
    if (propRectsOverlap(f, board)) return false;
    return !out.some(other => other.node !== 'rug_large' && propRectsOverlap(f, propPlacementFootprint(other), 0.15));
  };
  const add = (p: PropPlacement): boolean => { if (!clear(p)) return false; out.push(p); return true; };
  // Corners and entry planters may step inward around glazing instead of sliding
  // halfway along a wall. Search only a small neighbourhood of their intended anchor.
  const nearFloor = (node: PropKitNode, id: string, x: number, z: number): void => {
    const candidates: [number, number][] = [];
    for (let dx = -1.75; dx <= 1.75; dx += 0.25) for (let dz = -1.75; dz <= 1.75; dz += 0.25)
      candidates.push([x + dx, z + dz]);
    candidates.sort((a, c) => (a[0] - x) ** 2 + (a[1] - z) ** 2 - (c[0] - x) ** 2 - (c[1] - z) ** 2);
    for (const [px, pz] of candidates) if (add({ id, node, position: [px, 0.06, pz], rotation: 0 })) break;
  };
  const alongWall = (node: PropKitNode, id: string, wall: Wall, preferred: number): void => {
    const horizontal = wall === 'north' || wall === 'south';
    const [w, , d] = PROPKIT_SPECS[node].size;
    const start = (horizontal ? b.minX : b.minZ) + margin + w / 2;
    const end = (horizontal ? b.maxX : b.maxZ) - margin - w / 2;
    const candidates = [Math.max(start, Math.min(end, preferred)), end];
    for (let t = start; t <= end; t += 0.2) candidates.push(t);
    candidates.sort((a, c) => Math.abs(a - preferred) - Math.abs(c - preferred));
    for (const t of candidates) {
      const inset = margin + d / 2 + 0.01 + (node === 'arcade' ? 0.25 : 0);
      const x = horizontal ? t : wall === 'west' ? b.minX + inset : b.maxX - inset;
      const z = !horizontal ? t : wall === 'north' ? b.minZ + inset : b.maxZ - inset;
      const rotation = wall === 'north' ? 0 : wall === 'south' ? Math.PI : wall === 'east' ? -Math.PI / 2 : Math.PI / 2;
      const y = node.startsWith('wall_art') || node === 'office_tv' ? 1.5 : 0.06;
      if (add({ id, node, position: [x, y, z], rotation })) break;
    }
  };
  // Reserve the southwest corner for the arcade before placing corner plants.
  alongWall('arcade', 'arcade', 'west', b.maxZ - 1.5);
  for (const [id, x, z] of [
    ['nw', b.minX + 0.65, b.minZ + 0.65], ['ne', b.maxX - 0.65, b.minZ + 0.65],
    ['sw', b.minX + 0.65, b.maxZ - 0.65], ['se', b.maxX - 0.65, b.maxZ - 0.65],
  ] as const) nearFloor('plant_tall', `plant:${id}`, x, z);
  for (const entrance of layout.doorways.filter(d => d.kind === 'entrance')) {
    const wall = entrance.axis === 'x' ? (entrance.at[1] < (b.minZ + b.maxZ) / 2 ? 'north' : 'south')
      : (entrance.at[0] < centreX ? 'west' : 'east');
    const centre = entrance.at[entrance.axis === 'x' ? 0 : 1];
    for (const side of [-1, 1]) {
      const along = centre + side * (entrance.width / 2 + 1.55);
      nearFloor('plant_small', `${entrance.id}:plant:${side}`,
        entrance.axis === 'x' ? along : wall === 'west' ? b.minX + 0.6 : b.maxX - 0.6,
        entrance.axis === 'z' ? along : wall === 'north' ? b.minZ + 0.6 : b.maxZ - 0.6);
    }
  }
  for (const [node, ratio] of [['bookshelf', 0.2], ['water_cooler', 0.52], ['coffee_station', 0.8]] as const)
    alongWall(node, node, 'east', b.minZ + (b.maxZ - b.minZ) * ratio);
  alongWall('office_tv', 'office-tv', 'west', (b.minZ + b.maxZ) / 2);
  alongWall('floor_lamp', 'floor-lamp', 'south', centreX + 3);
  alongWall('wall_art_a', 'art:north', 'north', centreX - 4);
  alongWall('wall_art_b', 'art:south', 'south', centreX + 1);
  // A centred 4 m ceiling grid, filtered by the full pod boxes, doors and window strips.
  const nx = Math.max(1, Math.floor((b.maxX - b.minX) / 4));
  const nz = Math.max(1, Math.floor((b.maxZ - b.minZ) / 4));
  for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
    add({ id: `pendant:${ix}:${iz}`, node: 'pendant_lamp', rotation: 0,
      position: [b.minX + (ix + 0.5) * (b.maxX - b.minX) / nx, 2.3, b.minZ + (iz + 0.5) * (b.maxZ - b.minZ) / nz] });
  }
  for (const pod of layout.pods) out.push({ id: `rug:${pod.id}`, node: 'rug_large', rotation: 0,
    position: [(pod.minX + pod.maxX) / 2, 0.052, (pod.minZ + pod.maxZ) / 2],
    scale: [pod.maxX - pod.minX, 1, pod.maxZ - pod.minZ] });
  return out;
}

/** No GLB / readiness state: the procedural and baked visuals use these exact same envelopes. */
export function propkitColliderBoxes(layout: PropKitLayout = currentPropKitLayout()) {
  return propkitPlacements(layout).filter(p => PROPKIT_SPECS[p.node].solid)
    .map(p => ({ name: `propkit:${p.id}`, ...propPlacementFootprint(p) }));
}
