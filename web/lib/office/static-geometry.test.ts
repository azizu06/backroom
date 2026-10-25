// @vitest-environment node
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Box3, BoxGeometry, Color, Euler, Matrix4, Quaternion, Ray, SphereGeometry, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { mergeBoxes } from '../../app/office/mounts/StaticGeometry';
import { Plants } from '../../app/office/mounts/Plants';
import { TreasuryVault } from '../../app/office/mounts/TreasuryVault';
import { ServerRoom } from '../../app/office/rooms/ServerRoom';
import { deskPieces, workstationPieces, type FurniturePiece } from './furniture';
import { ANCHOR_IDS, BUILDING, FLOOR_FIXTURES, LOBBY_BOARD_MOUNT, WALL_HEIGHT, WALL_THICKNESS, WINDOWS, WINDOW_FRAME, WORKSTATIONS, wallPieces, windowPieces } from './layout';
import { EYE_HEIGHT, SERVER_ROOM, SPAWN, officeColliders } from './play';
import { OFFICE_LAMPS, lampPieces } from './lighting';
import { ROLES } from './palette';
import { INITIAL_OFFICE } from './state';
import { AUDIT_WALL } from './props/auditWall';
import { WHITEBOARD, WHITEBOARD_INTERACTION } from './props/whiteboard';

vi.mock('../../app/office/mounts/DeskKit', () => ({ useDeskKitReady: () => false }));

function renderedBounds(piece: FurniturePiece, primitive?: BufferGeometry): Box3 {
  const geometry = mergeBoxes([piece], primitive ? () => primitive : undefined);
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!.clone();
  geometry.dispose();
  return bounds;
}

/** Read the actual mounts' JSX/instance geometry under SSR, without WebGL or running effects. */
function mountBounds(render: () => React.ReactNode): Box3[] {
  type Props = {
    children?: React.ReactNode; position?: [number, number, number]; rotation?: [number, number, number];
    at?: FurniturePiece['at']; size?: FurniturePiece['size']; pieces?: FurniturePiece[]; geometry?: BufferGeometry; args?: number[];
  };
  const boxes: Box3[] = [];
  function visit(node: React.ReactNode, parent = new Matrix4()) {
    React.Children.forEach(node, child => {
      if (!React.isValidElement<Props>(child)) return;
      const props = child.props;
      if (props.at && props.size) {
        boxes.push(renderedBounds({ at: props.at, size: props.size, rotation: props.rotation, color: ROLES.frame }).applyMatrix4(parent));
        return;
      }
      if (props.pieces && props.geometry) {
        boxes.push(...props.pieces.map(piece => renderedBounds(piece, props.geometry).applyMatrix4(parent)));
        return;
      }
      const matrix = parent.clone().multiply(new Matrix4().compose(new Vector3(...(props.position ?? [0, 0, 0])),
        new Quaternion().setFromEuler(new Euler(...(props.rotation ?? [0, 0, 0]))), new Vector3(1, 1, 1)));
      if (child.type === 'mesh') React.Children.forEach(props.children, geometry => {
        if (!React.isValidElement<Props>(geometry)) return;
        const args = geometry.props.args ?? [];
        const primitive = geometry.type === 'boxGeometry' ? new BoxGeometry(args[0], args[1], args[2])
          : geometry.type === 'sphereGeometry' ? new SphereGeometry(args[0], args[1], args[2]) : null;
        if (!primitive) return;
        primitive.computeBoundingBox();
        boxes.push(primitive.boundingBox!.clone().applyMatrix4(matrix));
        primitive.dispose();
      });
      visit(props.children, matrix);
    });
  }
  vi.stubGlobal('React', React);
  try { renderToStaticMarkup(React.createElement(function Probe() { visit(render()); return null; })); }
  finally { vi.unstubAllGlobals(); }
  expect(boxes.length, 'mount must contribute rendered geometry').toBeGreaterThan(0);
  return boxes;
}

function enclosed(box: Box3) {
  expect(box.min.y).toBeGreaterThanOrEqual(-1e-5);
  expect(box.min.x).toBeGreaterThanOrEqual(BUILDING.minX + WALL_THICKNESS / 2 - 1e-5);
  expect(box.max.x).toBeLessThanOrEqual(BUILDING.maxX - WALL_THICKNESS / 2 + 1e-5);
  expect(box.min.z).toBeGreaterThanOrEqual(BUILDING.minZ + WALL_THICKNESS / 2 - 1e-5);
  expect(box.max.z).toBeLessThanOrEqual(BUILDING.maxZ - WALL_THICKNESS / 2 + 1e-5);
  expect(officeColliders(ANCHOR_IDS).some(c => c.minX <= box.min.x + 1e-5 && c.maxX >= box.max.x - 1e-5 &&
    c.minZ <= box.min.z + 1e-5 && c.maxZ >= box.max.z - 1e-5), `uncovered ${box.min.toArray()}..${box.max.toArray()}`).toBe(true);
}

function supported(parts: readonly Box3[], base = 0) {
  const reached = new Set(parts.flatMap((part, i) => Math.abs(part.min.y - base) < 1e-5 ? [i] : []));
  for (let pass = 0; pass < parts.length; pass++) for (let i = 0; i < parts.length; i++) {
    if ([...reached].some(j => parts[i]!.clone().expandByScalar(1e-5).intersectsBox(parts[j]!))) reached.add(i);
  }
  expect(reached.size, 'every piece connects to a floor/desk-supported piece').toBe(parts.length);
}

describe('merged static geometry', () => {
  it('rejects an empty batch before allocating geometry', () => {
    expect(() => mergeBoxes([])).toThrow(RangeError);
  });

  it('preserves transformed bounds, normals, triangle count and linear vertex colours in one draw group', () => {
    const geometry = mergeBoxes([
      { at: [2, 3, 4], size: [2, 4, 6], color: '#a9bc8f' },
      { at: [-2, 0, 0], size: [2, 4, 6], color: '#ed6252', rotation: [0, 0, Math.PI / 2] },
    ]);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.toArray()).toEqual([-4, -1, -3]);
    expect(geometry.boundingBox!.max.toArray()).toEqual([3, 5, 7]);
    expect(geometry.index!.count / 3).toBe(24);
    expect(geometry.groups).toEqual([]);
    const colors = geometry.getAttribute('color'), normals = geometry.getAttribute('normal');
    for (const [vertex, hex] of [[0, '#a9bc8f'], [24, '#ed6252']] as const) {
      const expected = new Color(hex);
      expect(colors.getX(vertex)).toBeCloseTo(expected.r);
      expect(colors.getY(vertex)).toBeCloseTo(expected.g);
      expect(colors.getZ(vertex)).toBeCloseTo(expected.b);
      expect(Math.hypot(normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex))).toBeCloseTo(1);
    }
    geometry.dispose();
  });

  it('bakes all ten desk and supported chair parts without dropping faces', () => {
    const geometry = mergeBoxes(deskPieces('dana'));
    expect(geometry.index!.count / 3).toBe(10 * 12);
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(1);
    geometry.dispose();
  });

  it('encloses every rendered desk, chair, leg, monitor and lamp and leaves no floating parts', () => {
    const groups = WORKSTATIONS.map(({ center, flip }) => ({ pieces: workstationPieces(center, flip, ROLES.partition), base: 0 }));
    groups.push(...OFFICE_LAMPS.map(lamp => ({ pieces: lampPieces(lamp), base: lamp.floor ? 0 : 0.91 })));
    for (const { pieces, base } of groups) {
      const boxes = pieces.map(piece => renderedBounds(piece));
      supported(boxes, base);
      boxes.forEach(enclosed);
    }
  });

  it('supports and encloses the rendered vault, server rack and plants', () => {
    const groups = [
      mountBounds(() => TreasuryVault({ snapshot: { ...INITIAL_OFFICE, rooms: undefined } })),
      mountBounds(() => ServerRoom({ position: [SERVER_ROOM.position[0], 0, SERVER_ROOM.position[1]], replay: true })),
      mountBounds(() => Plants()),
    ];
    expect(groups.map(parts => parts.length)).toEqual([3, 8, 4]);
    for (const parts of groups) { supported(parts); parts.forEach(enclosed); }
  });

  it('supports wall boards flush against solid walls, covers their colliders and reserves the entire ticket-board span', () => {
    const notice = LOBBY_BOARD_MOUNT, whiteZ = BUILDING.minZ + WALL_THICKNESS / 2 + WHITEBOARD.depth / 2;
    const panels = [
      { wall: 'north', piece: { at: [notice.x, notice.y, notice.z], size: [notice.width, notice.height, notice.depth], color: ROLES.frame } },
      { wall: 'north', piece: { at: [WHITEBOARD_INTERACTION.position[0], WHITEBOARD.bottom + WHITEBOARD.height / 2, whiteZ],
        size: [WHITEBOARD.width, WHITEBOARD.height, WHITEBOARD.depth], color: ROLES.frame } },
      { wall: 'west', piece: { at: [AUDIT_WALL.x, AUDIT_WALL.bottom + AUDIT_WALL.height / 2, AUDIT_WALL.z],
        size: [AUDIT_WALL.width, AUDIT_WALL.height, 0.06], rotation: [0, AUDIT_WALL.rotationY, 0], color: ROLES.frame } },
      // Reserved wall surface, not a new ticket-board renderer or collider.
      { wall: 'north', piece: { at: [0, WALL_HEIGHT / 2, BUILDING.minZ + WALL_THICKNESS / 2], size: [6, WALL_HEIGHT, 0], color: ROLES.frame } },
    ] satisfies { wall: string; piece: FurniturePiece }[];
    const walls = wallPieces('full').map(piece => renderedBounds(piece));
    const frames = windowPieces().frames.map(piece => renderedBounds(piece));
    const boxes = panels.map(({ piece }) => renderedBounds(piece));
    for (let i = 0; i < panels.length; i++) {
      const box = boxes[i]!, axis = panels[i]!.wall === 'north' ? 'x' : 'z';
      enclosed(box);
      // Exact projected intervals, including frame widths, catch even a partial window overlap.
      for (const win of WINDOWS.filter(win => win.wall === panels[i]!.wall)) {
        expect(box.max[axis] <= win.at - win.width / 2 - WINDOW_FRAME || box.min[axis] >= win.at + win.width / 2 + WINDOW_FRAME).toBe(true);
      }
      for (const obstacle of [...walls, ...frames, ...boxes.filter((_, j) => j !== i)]) {
        expect(['x', 'y', 'z'].every(key => {
          const axis = key as 'x' | 'y' | 'z';
          return Math.min(box.max[axis], obstacle.max[axis]) - Math.max(box.min[axis], obstacle.min[axis]) > 1e-5;
        }), 'panel must not penetrate another solid').toBe(false);
      }
      for (const u of [0, 0.5, 1]) for (const v of [0, 0.5, 1]) {
        const rear = axis === 'x'
          ? new Vector3(box.min.x + u * (box.max.x - box.min.x), box.min.y + v * (box.max.y - box.min.y), box.min.z - 1e-5)
          : new Vector3(box.min.x - 1e-5, box.min.y + v * (box.max.y - box.min.y), box.min.z + u * (box.max.z - box.min.z));
        expect(walls.some(wall => wall.containsPoint(rear)), 'every rear corner and centre rests on solid wall').toBe(true);
      }
    }
    const tray = renderedBounds({ at: [WHITEBOARD_INTERACTION.position[0], WHITEBOARD.bottom - 0.02, whiteZ + 0.07], size: [1.1, 0.05, 0.14], color: ROLES.partition });
    enclosed(tray);
    expect(tray.intersectsBox(boxes[1]!)).toBe(true);
  });

  it('keeps the vault and east lamp clear of the adjacent window frames', () => {
    for (const { wall, fixture, axis } of [
      { wall: 'south', fixture: FLOOR_FIXTURES.vault, axis: 'x' },
      { wall: 'east', fixture: FLOOR_FIXTURES.lampEast, axis: 'z' },
    ] as const) {
      const center = fixture[axis], half = (axis === 'x' ? fixture.width : fixture.depth) / 2;
      for (const win of WINDOWS.filter(win => win.wall === wall)) {
        expect(center + half < win.at - win.width / 2 - WINDOW_FRAME || center - half > win.at + win.width / 2 + WINDOW_FRAME).toBe(true);
      }
    }
  });

  it('sees the notice board and reserved ticket-board centre from the entry over/along the pods', () => {
    const origin = new Vector3(SPAWN.position[0], EYE_HEIGHT, SPAWN.position[1]);
    const board = LOBBY_BOARD_MOUNT;
    const targets = [new Vector3(board.x, board.y, board.z), new Vector3(0, 2.2, BUILDING.minZ + WALL_THICKNESS / 2)];
    const obstacles = WORKSTATIONS.flatMap(({ center, flip }) => workstationPieces(center, flip, ROLES.partition).map(piece => renderedBounds(piece)));
    for (const target of targets) {
      const ray = new Ray(origin, target.clone().sub(origin).normalize());
      for (const obstacle of obstacles) {
        const hit = ray.intersectBox(obstacle, new Vector3());
        expect(hit && hit.distanceTo(origin) < target.distanceTo(origin), `blocked board sightline by ${obstacle.min.toArray()}`).toBeFalsy();
      }
    }
  });
});
