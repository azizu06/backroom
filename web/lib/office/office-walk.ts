import type { Rect, Vec2 } from './layout';

export interface WalkLayout {
  building: Rect;
  spawn: { position: Vec2; yaw: number };
  workstations: readonly { id: string; pod: number; center: Vec2; flip: 1 | -1 }[];
  anchors: Readonly<Record<string, { position: Vec2; center: Vec2 }>>;
  doorways: readonly { id: string; axis: 'x' | 'z'; at: Vec2 }[];
  boards: readonly { id: string; position: Vec2 }[];
  desk: { width: number; depth: number };
  chair: { x: number; z: number; width: number; depth: number };
  colliders: readonly Rect[];
  radius: number;
  eyeHeight: number;
}
export interface WalkSpot {
  id: string;
  kind: 'spawn' | 'aisle' | 'seat' | 'anchor' | 'board' | 'doorway';
  position: Vec2;
  eye: readonly [number, number, number];
  yaw: number;
}
export interface WalkStop { spot: WalkSpot; path: Vec2[] }

const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const bearing = (a: Vec2, b: Vec2) => Math.atan2(a[0] - b[0], a[1] - b[1]);
const inflate = (box: Rect, r: number): Rect => ({ minX: box.minX - r, maxX: box.maxX + r, minZ: box.minZ - r, maxZ: box.maxZ + r });
const contains = (b: Rect, p: Vec2) => p[0] > b.minX && p[0] < b.maxX && p[1] > b.minZ && p[1] < b.maxZ;

/** Slab intersection, including tangencies; checks the entire segment, not just its endpoints. */
export function segmentClear(a: Vec2, b: Vec2, colliders: readonly Rect[], radius: number): boolean {
  return !colliders.some(raw => {
    const box = inflate(raw, radius);
    let low = 0, high = 1;
    for (const [axis, min, max] of [[0, box.minX, box.maxX], [1, box.minZ, box.maxZ]] as const) {
      const delta = b[axis] - a[axis];
      if (Math.abs(delta) < 1e-10) { if (a[axis] < min || a[axis] > max) return false; }
      else {
        const t1 = (min - a[axis]) / delta, t2 = (max - a[axis]) / delta;
        low = Math.max(low, Math.min(t1, t2)); high = Math.min(high, Math.max(t1, t2));
        if (low > high) return false;
      }
    }
    return true;
  });
}

/** Pure visibility graph. Corners have extra steering clearance; endpoints retain their authored positions. */
export function planWalkPath(from: Vec2, to: Vec2, layout: Pick<WalkLayout, 'colliders' | 'building' | 'radius'>): Vec2[] {
  const { colliders, building, radius } = layout;
  const clear = (p: Vec2) => contains(inflate(building, -radius), p) && !colliders.some(b => contains(inflate(b, radius), p));
  if (!clear(from) || !clear(to)) throw new Error(`Unstandable route endpoint: ${from} -> ${to}`);
  if (segmentClear(from, to, colliders, radius + 0.015)) return distance(from, to) < 1e-6 ? [] : [to];
  const corners = colliders.flatMap(b => {
    const c = inflate(b, radius + 0.18);
    return [[c.minX, c.minZ], [c.minX, c.maxZ], [c.maxX, c.minZ], [c.maxX, c.maxZ]] as Vec2[];
  }).filter(clear);
  const nodes = [from, to, ...corners], costs = nodes.map(() => Infinity), previous = nodes.map(() => -1);
  const visited = new Set<number>(); costs[0] = 0;
  while (visited.size < nodes.length) {
    let best = -1;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (best < 0 || costs[i]! < costs[best]!)) best = i;
    if (best < 0 || !Number.isFinite(costs[best])) break;
    if (best === 1) {
      const path: Vec2[] = [];
      for (let i = 1; i !== 0; i = previous[i]!) path.unshift(nodes[i]!);
      return path;
    }
    visited.add(best);
    for (let i = 0; i < nodes.length; i++) {
      if (visited.has(i)) continue;
      const cost = costs[best]! + distance(nodes[best]!, nodes[i]!);
      if (cost < costs[i]! && segmentClear(nodes[best]!, nodes[i]!, colliders, radius + 0.015)) {
        costs[i] = cost; previous[i] = best;
      }
    }
  }
  throw new Error(`No walkable route: ${from} -> ${to}`);
}

/** Inward normal of the nearest exterior wall; no fixed room dimensions or compass assumptions. */
function inward(point: Vec2, b: Rect): Vec2 {
  return ([{ d: Math.abs(point[0] - b.minX), n: [1, 0] }, { d: Math.abs(point[0] - b.maxX), n: [-1, 0] },
    { d: Math.abs(point[1] - b.minZ), n: [0, 1] }, { d: Math.abs(point[1] - b.maxZ), n: [0, -1] }]
    .sort((a, c) => a.d - c.d)[0]!.n) as unknown as Vec2;
}

/** Follow the connected mount/trim footprint to its room-facing surface. The sight ray
 * ends just outside that surface, so the board (or closed door) does not occlude itself.
 * Disconnected fixtures remain sight blockers, even when they are close to the mount.
 */
function approachTarget(target: Vec2, normal: Vec2, colliders: readonly Rect[]): Vec2 {
  const axis = normal[0] ? 0 : 1, along = axis === 0 ? 1 : 0, sign = normal[axis];
  const intervals = colliders.filter(box => target[along] >= (along === 0 ? box.minX : box.minZ) - 1e-7
      && target[along] <= (along === 0 ? box.maxX : box.maxZ) + 1e-7)
    .map(box => {
      const a = ((axis === 0 ? box.minX : box.minZ) - target[axis]) * sign;
      const b = ((axis === 0 ? box.maxX : box.maxZ) - target[axis]) * sign;
      return [Math.min(a, b), Math.max(a, b)] as const;
    }).sort((a, b) => a[0] - b[0]);
  let depth = 0;
  for (const [start, end] of intervals) {
    if (start > depth + 1e-7) break;
    depth = Math.max(depth, end);
  }
  return [target[0] + normal[0] * (depth + 0.001), target[1] + normal[1] * (depth + 0.001)];
}

/** Search 10 cm tiles along the wall and in depth, nearest the nominal approach first.
 * Every candidate is within 2 m of the mount and must have both body clearance and sight.
 */
function wallApproach(id: string, target: Vec2, normals: readonly Vec2[], offset: number,
  layout: WalkLayout, clear: (point: Vec2) => boolean): Vec2 {
  const candidates: { position: Vec2; aim: Vec2; cost: number }[] = [];
  for (const normal of normals) {
    const aim = approachTarget(target, normal, layout.colliders);
    for (let depth = 1; depth <= 20; depth++) for (let side = -20; side <= 20; side++) {
      const forward = depth / 10, lateral = side / 10;
      if (Math.hypot(forward, lateral) > 2 + 1e-7) continue;
      const position: Vec2 = [target[0] + normal[0] * forward - normal[1] * lateral,
        target[1] + normal[1] * forward + normal[0] * lateral];
      // Never stand behind the derived front surface, even if the mount is unusually deep.
      if ((position[0] - aim[0]) * normal[0] + (position[1] - aim[1]) * normal[1] <= 0) continue;
      candidates.push({ position, aim, cost: Math.hypot(forward - offset, lateral) });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  const found = candidates.find(({ position, aim }) => clear(position) && segmentClear(position, aim, layout.colliders, 0));
  if (found) return found.position;
  const nearby = layout.colliders.filter(box => distance(target,
    [Math.max(box.minX, Math.min(box.maxX, target[0])), Math.max(box.minZ, Math.min(box.maxZ, target[1]))]) <= 2);
  throw new Error(`No clear approach with sightline to ${id} within 2 m of ${target}; colliders: ${JSON.stringify(nearby)}`);
}

export function buildOfficeWalk(layout: WalkLayout): { hash: string; stops: WalkStop[] } {
  const { building, radius, chair, desk } = layout;
  const spots: WalkSpot[] = [];
  const clear = (p: Vec2) => contains(inflate(building, -radius), p)
    && !layout.colliders.some(b => contains(inflate(b, radius + 0.025), p));
  const add = (id: string, kind: WalkSpot['kind'], position: Vec2, target?: Vec2, yaw = 0) => {
    if (!clear(position)) throw new Error(`Walk spot ${id} is obstructed at ${position}`);
    spots.push({ id, kind, position, eye: [position[0], layout.eyeHeight, position[1]], yaw: target ? bearing(position, target) : yaw });
  };
  add('spawn', 'spawn', layout.spawn.position, undefined, layout.spawn.yaw);
  for (const pod of new Set(layout.workstations.map(s => s.pod))) {
    const seats = layout.workstations.filter(s => s.pod === pod);
    const minX = Math.min(...seats.map(s => s.center[0] - desk.width / 2));
    const maxX = Math.max(...seats.map(s => s.center[0] + desk.width / 2));
    const reach = Math.max(desk.depth / 2, Math.abs(chair.z) + chair.depth / 2);
    const minZ = Math.min(...seats.map(s => s.center[1] - reach));
    const maxZ = Math.max(...seats.map(s => s.center[1] + reach));
    const center: Vec2 = [(minX + maxX) / 2, (minZ + maxZ) / 2], gap = radius + 0.25;
    for (const [side, position] of [['west', [minX - gap, center[1]]], ['east', [maxX + gap, center[1]]],
      ['north', [center[0], minZ - gap]], ['south', [center[0], maxZ + gap]]] as const) {
      const alongX = side === 'north' || side === 'south';
      const alternatives = [position, ...[-0.25, 0.25, -0.45, 0.45].map(fraction => (
        alongX ? [position[0] + fraction * (maxX - minX), position[1]]
          : [position[0], position[1] + fraction * (maxZ - minZ)]
      ) as Vec2)];
      const approach = alternatives.find(clear);
      if (!approach) throw new Error(`No clear ${side} aisle for pod ${pod}`);
      add(`pod-${pod}-${side}`, 'aisle', approach, center);
    }
    for (const seat of seats) add(`seat-${seat.id}`, 'seat',
      [seat.center[0], seat.center[1] + seat.flip * (reach + radius + 0.1)], seat.center);
  }
  for (const [id, anchor] of Object.entries(layout.anchors)) add(`anchor-${id}`, 'anchor', anchor.position, anchor.center);
  for (const board of layout.boards) {
    const n = inward(board.position, building);
    add(`board-${board.id}`, 'board', wallApproach(`board-${board.id}`, board.position, [n], 1, layout, clear), board.position);
  }
  for (const door of layout.doorways) {
    // Logical interior doors may be approached from either side of their wall.
    const axis = door.axis === 'x' ? 1 : 0;
    const middle = axis === 0 ? (building.minX + building.maxX) / 2 : (building.minZ + building.maxZ) / 2;
    const sign = Math.sign(middle - door.at[axis]) || 1;
    const normal: Vec2 = axis === 0 ? [sign, 0] : [0, sign];
    const position = wallApproach(`doorway-${door.id}`, door.at, [normal, [-normal[0], -normal[1]]], 0.9, layout, clear);
    add(`doorway-${door.id}`, 'doorway', position, door.at);
  }
  // Deterministic nearest-neighbour ordering limits backtracking between nearby destinations.
  const pending = spots.slice(1), stops: WalkStop[] = [{ spot: spots[0]!, path: [] }];
  let position = layout.spawn.position;
  while (pending.length) {
    pending.sort((a, b) => distance(position, a.position) - distance(position, b.position) || a.id.localeCompare(b.id));
    const spot = pending.shift()!;
    const path = planWalkPath(position, spot.position, layout);
    stops.push({ spot, path }); position = spot.position;
  }
  // Stable FNV-1a over all geometry/poses, not a hand-maintained layout name.
  let hash = 2166136261;
  for (const char of JSON.stringify(layout)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return { hash: (hash >>> 0).toString(16).padStart(8, '0'), stops };
}

/** Reject solid and almost-solid frames, tolerating a few antialiasing/noise pixels. RGBA input. */
export function frameHasGeometry(pixels: ArrayLike<number>): boolean {
  if (pixels.length < 16 || pixels.length % 4 !== 0) return false;
  const colors = new Map<number, number>();
  for (let i = 0; i < pixels.length; i += 4) {
    const color = (pixels[i]! >> 4) * 256 + (pixels[i + 1]! >> 4) * 16 + (pixels[i + 2]! >> 4);
    colors.set(color, (colors.get(color) ?? 0) + 1);
  }
  return Math.max(...colors.values()) / (pixels.length / 4) < 0.995;
}
