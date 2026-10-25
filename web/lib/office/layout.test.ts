import { describe, expect, it } from 'vitest';
import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { BUILDING, MAIN_BUILDING, WORKSTATIONS, ANCHOR_IDS, ROOM_SPAWNS, WALLS, WINDOWS, WALL_HEIGHT, WALL_THICKNESS, LOBBY_BOARD_MOUNT, DOORWAYS, GRID_AISLES, POD_BOUNDS, FLOOR_FIXTURES, fixtureBounds, workspaceRoute, workstationApproach, sightBlocked, wallPieces, windowPieces, type Vec2 } from './layout';
import { EXTRA_WORKSTATIONS, deskPieces, deskScreenPiece, workstationPieces } from './furniture';
import { CAMERA_CLEARANCE, DESK_SIZE } from './metrics';
import { DESKS } from './targets/desk';
import { OFFICE_ANCHORS } from './state';
import { EYE_HEIGHT, FLOOR, SPAWN, PLAYER_RADIUS, PAYLINK_KIOSK, insideAny, movePlayer, officeColliders } from './play';
import { HANDOFF_AGENTS, handoffRoute, handoffSpot, workstationLabel, type HandoffAgentId } from './handoffs';
import { roomEntry } from './overview';
import { storyCameraPose } from './story';
import { TOUR_ORDER } from './tour';
import { TREES, BUSHES, groundClear } from './outdoors';
import { AUDIT_WALL } from './props/auditWall';
import { WHITEBOARD_INTERACTION } from './props/whiteboard';
import { ROLES } from './palette';

const colliders = officeColliders(ANCHOR_IDS);
function walk(from: Vec2, to: Vec2): Vec2 {
  let point = from;
  const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.05));
  const step: Vec2 = [(to[0] - from[0]) / steps, (to[1] - from[1]) / steps];
  for (let i = 0; i < steps; i++) {
    point = movePlayer(point, step, colliders);
    expect(insideAny(point, colliders, CAMERA_CLEARANCE), `${from} → ${to}: ${point}`).toBe(false);
  }
  expect(point[0]).toBeCloseTo(to[0], 5);
  expect(point[1]).toBeCloseTo(to[1], 5);
  return point;
}
function follow(from: Vec2, to: Vec2) {
  const route = workspaceRoute(from, to);
  expect(route[0]).toEqual(from);
  expect(route.at(-1)).toEqual(to); // A stalled/empty route is not evidence of reachability.
  for (let i = 1; i < route.length; i++) walk(route[i - 1]!, route[i]!);
}

describe('square shared office', () => {
  it('has a 24 m square, four exterior walls and a centred south entrance', () => {
    expect(BUILDING).toEqual(MAIN_BUILDING);
    expect(BUILDING.maxX - BUILDING.minX).toBe(24);
    expect(BUILDING.maxX - BUILDING.minX).toBe(BUILDING.maxZ - BUILDING.minZ);
    expect(WALLS).toHaveLength(4);
    expect(WALLS.every(wall => wall.exterior)).toBe(true);
    expect(DOORWAYS.find(door => door.id === 'entrance')!.at).toEqual([0, BUILDING.maxZ]);
    const full = wallPieces('full');
    expect(Math.max(...full.map(piece => piece.at[1] + piece.size[1] / 2))).toBe(WALL_HEIGHT);
    expect(full.every(piece => piece.size.every(size => size > 0))).toBe(true);
    expect(windowPieces().glass).toHaveLength(WINDOWS.length);
    for (const win of WINDOWS.filter(win => win.wall === 'north')) expect(Math.abs(win.at) - win.width / 2).toBeGreaterThan(3);
    expect(Math.abs(LOBBY_BOARD_MOUNT.x) - LOBBY_BOARD_MOUNT.width / 2).toBeGreaterThan(3);
  });

  it('keeps six 2 × 2 pods, twenty-four human-scale desks and sixteen open seats', () => {
    expect(WORKSTATIONS).toHaveLength(24);
    expect(EXTRA_WORKSTATIONS).toHaveLength(20);
    expect(WORKSTATIONS.filter((_, i) => workstationLabel(i) === 'Open seat')).toHaveLength(16);
    expect(DESK_SIZE).toEqual({ width: 2.25, depth: 1.05 });
    expect(EYE_HEIGHT).toBe(1.55);
    for (let pod = 0; pod < 6; pod++) {
      const seats = WORKSTATIONS.filter(seat => seat.pod === pod);
      expect(seats).toHaveLength(4);
      expect(new Set(seats.map(seat => seat.center[0])).size).toBe(2);
      expect(new Set(seats.map(seat => seat.center[1])).size).toBe(2);
      expect(seats.filter(seat => seat.flip === 1)).toHaveLength(2);
    }
    const pieces = WORKSTATIONS.flatMap(({ center, flip }) => workstationPieces(center, flip, ROLES.partition));
    expect(pieces.filter(piece => piece.color === ROLES.desk && piece.size[0] === 2.25)).toHaveLength(24);
    for (const room of DESKS) {
      expect(WORKSTATIONS.some(seat => String(seat.center) === String(OFFICE_ANCHORS[room].center))).toBe(true);
      expect(deskScreenPiece(room).at[2] - deskPieces(room)[3]!.at[2]).toBeCloseTo((room === 'dana' ? -1 : 1) * 0.05);
    }
  });

  it('spaces windows evenly in symmetric bays around the north board span and south entrance', () => {
    for (const wall of ['north', 'south']) {
      const centers = WINDOWS.filter(win => win.wall === wall).map(win => win.at).sort((a, b) => a - b);
      expect(centers).toHaveLength(4);
      expect(centers).toEqual(centers.map(at => -at).reverse());
      const pitch = centers[1]! - centers[0]!;
      expect(pitch).toBeGreaterThan(0);
      expect(centers[3]! - centers[2]!).toBeCloseTo(pitch);
      // The reserved centre skips whole bays, preserving the same spacing grid on both sides.
      expect((centers[2]! - centers[1]!) / pitch).toBeCloseTo(Math.round((centers[2]! - centers[1]!) / pitch));
    }
  });

  it('measures clear aisles >= 2.4 m, perimeter >= 2.5 m and a south band >= 4 m from rendered furniture', () => {
    const pods = POD_BOUNDS.map((_, pod) => {
      const bounds = new Box3();
      for (const { center, flip } of WORKSTATIONS.filter(seat => seat.pod === pod)) {
        for (const piece of workstationPieces(center, flip, ROLES.partition)) {
          const half = new Vector3(...piece.size).multiplyScalar(0.5);
          bounds.union(new Box3(half.clone().negate(), half).applyMatrix4(new Matrix4().compose(new Vector3(...piece.at),
            new Quaternion().setFromEuler(new Euler(...(piece.rotation ?? [0, 0, 0]))), new Vector3(1, 1, 1))));
        }
      }
      return bounds;
    });
    for (const pod of pods) {
      expect(pod.min.x - FLOOR.minX).toBeGreaterThanOrEqual(2.5);
      expect(FLOOR.maxX - pod.max.x).toBeGreaterThanOrEqual(2.5);
      expect(pod.min.z - FLOOR.minZ).toBeGreaterThanOrEqual(2.5);
      expect(FLOOR.maxZ - pod.max.z).toBeGreaterThanOrEqual(4);
    }
    for (const row of [0, 3]) for (const column of [0, 1]) expect(pods[row + column + 1]!.min.x - pods[row + column]!.max.x).toBeGreaterThanOrEqual(2.4);
    for (let column = 0; column < 3; column++) expect(pods[column + 3]!.min.z - pods[column]!.max.z).toBeGreaterThanOrEqual(2.4);
    for (const pod of POD_BOUNDS) for (const fixture of Object.values(FLOOR_FIXTURES).map(fixtureBounds)) {
      const dx = Math.max(0, pod.minX - fixture.maxX, fixture.minX - pod.maxX);
      const dz = Math.max(0, pod.minZ - fixture.maxZ, fixture.minZ - pod.maxZ);
      expect(Math.hypot(dx, dz), 'perimeter props preserve the pod walkway').toBeGreaterThanOrEqual(2.5);
    }
    expect(WALL_THICKNESS).toBeGreaterThan(0);
  });

  it('has clear teleports, board sightlines and clear approaches to all twenty-four seats', () => {
    expect(insideAny(SPAWN.position, colliders, 1)).toBe(false);
    for (const spawn of Object.values(ROOM_SPAWNS)) {
      expect(insideAny(spawn.position, colliders, CAMERA_CLEARANCE), String(spawn.position)).toBe(false);
      expect(spawn.position[0]).toBeGreaterThan(FLOOR.minX);
      expect(spawn.position[0]).toBeLessThan(FLOOR.maxX);
      follow(SPAWN.position, spawn.position);
    }
    for (const id of ANCHOR_IDS) {
      const entry = roomEntry(id, colliders);
      expect(insideAny(entry.position, colliders, PLAYER_RADIUS), id).toBe(false);
      expect(sightBlocked(...SPAWN.position, ...OFFICE_ANCHORS[id].position), id).toBe(false);
    }
    for (let i = 0; i < WORKSTATIONS.length; i++) follow(SPAWN.position, workstationApproach(i));
  });

  it('walks both perimeter lanes and all grid aisles', () => {
    for (const x of GRID_AISLES.x) walk([x, GRID_AISLES.z[0]!], [x, GRID_AISLES.z.at(-1)!]);
    for (const z of GRID_AISLES.z) walk([GRID_AISLES.x[0]!, z], [GRID_AISLES.x.at(-1)!, z]);
  });

  it('spreads seven agents and Dana across all six pods and walks every handoff', () => {
    const ids = Object.keys(HANDOFF_AGENTS) as HandoffAgentId[];
    const stations = ids.map(id => HANDOFF_AGENTS[id].station);
    expect(new Set(stations.map(String)).size).toBe(8);
    const seats = stations.map(station => WORKSTATIONS.findIndex((_, i) => String(workstationApproach(i)) === String(station)));
    expect(seats.every(i => i >= 0)).toBe(true);
    expect(new Set(seats.map(i => WORKSTATIONS[i]!.pod)).size).toBe(6);
    for (const from of ids) for (const to of ids) {
      const route = handoffRoute(from, to);
      expect(route.at(-1)).toEqual(handoffSpot(to));
      for (let i = 1; i < route.length; i++) walk(route[i - 1]!, route[i]!);
    }
  });

  it('walks every story/tour destination pair with 0.4 m camera clearance and unchanged eye height', () => {
    for (const from of TOUR_ORDER) for (const to of TOUR_ORDER) {
      const a = storyCameraPose(from).position, b = storyCameraPose(to).position;
      expect(a[1]).toBe(EYE_HEIGHT);
      follow([a[0], a[2]], [b[0], b[2]]);
    }
  });

  it('reaches the wall boards, counter, vault and rack without crossing pods', () => {
    follow(SPAWN.position, [AUDIT_WALL.x + 0.9, AUDIT_WALL.z]);
    follow(SPAWN.position, WHITEBOARD_INTERACTION.position);
    follow(SPAWN.position, [PAYLINK_KIOSK[0] + 1.2, PAYLINK_KIOSK[1]]);
    follow(SPAWN.position, [LOBBY_BOARD_MOUNT.x, BUILDING.minZ + 2]);
  });

  it('keeps outdoor foliage clear of the larger footprint and centred entrance', () => {
    for (const tree of TREES) expect(groundClear(tree.x, tree.z, tree.radius, 3.9)).toBe(true);
    for (const bush of BUSHES) expect(groundClear(bush.x, bush.z, bush.size * 0.5, 0.4)).toBe(true);
  });
});
