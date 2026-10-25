import { readFileSync } from 'node:fs';
import { Box3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { CHAIR_FOOTPRINT, workstationPieces, type FurniturePiece } from './furniture';
import { TREASURY_VAULT, deskKitPlacements } from './deskkit';
import { ANCHOR_IDS, BUILDING, LOBBY_BOARD_MOUNT, WALL_THICKNESS, WORKSTATIONS, wallPieces, windowPieces } from './layout';
import { PLAYER_RADIUS, SERVER_ROOM_BOX, insideAny, movePlayer, officeColliders } from './play';
import { ROLES } from './palette';
import { AUDIT_WALL } from './props/auditWall';
import { WHITEBOARD, WHITEBOARD_INTERACTION } from './props/whiteboard';

const EPS = 1e-5;
const colliders = officeColliders(ANCHOR_IDS, [SERVER_ROOM_BOX]);

function bounds(piece: FurniturePiece): Box3 {
  const half = new Vector3(...piece.size).multiplyScalar(0.5);
  return new Box3(half.clone().negate(), half).applyMatrix4(new Matrix4().compose(
    new Vector3(...piece.at), new Quaternion().setFromEuler(new Euler(...(piece.rotation ?? [0, 0, 0]))), new Vector3(1, 1, 1),
  ));
}

function overlaps(a: Box3, b: Box3): boolean {
  return ['x', 'y', 'z'].every(axis => {
    const key = axis as 'x' | 'y' | 'z';
    return Math.min(a.max[key], b.max[key]) - Math.max(a.min[key], b.min[key]) > EPS;
  });
}

function expectIndoor(box: Box3) {
  expect(box.min.x).toBeGreaterThanOrEqual(BUILDING.minX + WALL_THICKNESS / 2 - EPS);
  expect(box.max.x).toBeLessThanOrEqual(BUILDING.maxX - WALL_THICKNESS / 2 + EPS);
  expect(box.min.z).toBeGreaterThanOrEqual(BUILDING.minZ + WALL_THICKNESS / 2 - EPS);
  expect(box.max.z).toBeLessThanOrEqual(BUILDING.maxZ - WALL_THICKNESS / 2 + EPS);
}

function expectSolidFootprint(box: Box3) {
  // One collider must enclose the whole rendered footprint, not just its centre.
  expect(colliders.some(c => c.minX <= box.min.x + EPS && c.maxX >= box.max.x - EPS
    && c.minZ <= box.min.z + EPS && c.maxZ >= box.max.z - EPS), `uncovered footprint ${box.min.toArray()}..${box.max.toArray()}`).toBe(true);
}

describe('open office support and clipping', () => {
  it('supports all twenty-four chairs and monitors, encloses chairs in collisions and separates neighboring seats', () => {
    const stations = WORKSTATIONS.map(({ center, flip }) => workstationPieces(center, flip, ROLES.partition).map(bounds));
    for (const pieces of stations) {
      pieces.forEach(expectIndoor);
      const [top, leftLeg, rightLeg, casing, stand, , seat, back, stem, base] = pieces as [Box3, Box3, Box3, Box3, Box3, Box3, Box3, Box3, Box3, Box3];
      expect(overlaps(top, leftLeg) && overlaps(top, rightLeg)).toBe(true);
      expect(overlaps(top, stand) && overlaps(stand, casing)).toBe(true);
      expect(overlaps(seat, back)).toBe(true);
      expect(stem.max.y).toBeCloseTo(seat.min.y);
      expect(overlaps(base, stem)).toBe(true);
      expect(base.min.y).toBeCloseTo(0);
      for (const part of [seat, back, stem, base]) expectSolidFootprint(part);
    }
    for (let i = 0; i < stations.length; i++) for (let j = i + 1; j < stations.length; j++) {
      for (const a of stations[i]!) for (const b of stations[j]!) expect(overlaps(a, b), `seats ${i} and ${j}`).toBe(false);
    }
    expect(CHAIR_FOOTPRINT.depth).toBeGreaterThanOrEqual(0.6);
  });

  it('backs evidence panels with solid wall faces without penetrating walls or window frames', () => {
    const board = LOBBY_BOARD_MOUNT;
    const whiteZ = BUILDING.minZ + WALL_THICKNESS / 2 + WHITEBOARD.depth / 2;
    const panels: FurniturePiece[] = [
      { at: [board.x, board.y, board.z], size: [board.width, board.height, board.depth], color: '' },
      { at: [WHITEBOARD_INTERACTION.position[0], WHITEBOARD.bottom + WHITEBOARD.height / 2, whiteZ],
        size: [WHITEBOARD.width, WHITEBOARD.height, WHITEBOARD.depth], color: '' },
      { at: [AUDIT_WALL.x, AUDIT_WALL.bottom + AUDIT_WALL.height / 2, AUDIT_WALL.z],
        size: [AUDIT_WALL.width, AUDIT_WALL.height, 0.06], rotation: [0, AUDIT_WALL.rotationY, 0], color: '' },
    ];
    const walls = wallPieces('full').map(bounds), frames = windowPieces().frames.map(bounds);
    panels.forEach((panel, index) => {
      const box = bounds(panel);
      expectIndoor(box);
      expectSolidFootprint(box);
      for (const obstacle of [...walls, ...frames]) expect(overlaps(box, obstacle)).toBe(false);
      // Sample the entire rear face, so a board over an opening cannot count as supported.
      for (const u of [0, 0.5, 1]) for (const v of [0, 0.5, 1]) {
        const rear = index === 2
          ? new Vector3(box.min.x - EPS, box.min.y + u * (box.max.y - box.min.y), box.min.z + v * (box.max.z - box.min.z))
          : new Vector3(box.min.x + u * (box.max.x - box.min.x), box.min.y + v * (box.max.y - box.min.y), box.min.z - EPS);
        expect(walls.some(wall => wall.containsPoint(rear)), `unsupported panel ${index}: ${rear.toArray()}`).toBe(true);
      }
    });
    expect(board.faceOffset).toBeGreaterThan(board.depth / 2);
    expect(board.faceOffset - board.depth / 2).toBeLessThan(0.01);
    const tray = bounds({ at: [WHITEBOARD_INTERACTION.position[0], WHITEBOARD.bottom - 0.02, whiteZ + 0.07], size: [1.1, 0.05, 0.14], color: '' });
    expectSolidFootprint(tray);
    const start = [WHITEBOARD_INTERACTION.position[0], BUILDING.minZ + 2] as const;
    const stop = movePlayer(start, [0, -2], colliders, PLAYER_RADIUS);
    expect(stop[1]).toBeCloseTo(tray.max.z + PLAYER_RADIUS, 3);
    expect(insideAny(stop, colliders, PLAYER_RADIUS)).toBe(false);
  });

  it('encloses the actual opt-in kit chairs and vault handles and keeps mounted desk props supported', async () => {
    // Parse the local GLB from memory: no fetch, server or external assets.
    const bytes = readFileSync(new URL('../../public/office-art/deskkit.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    for (const placement of deskKitPlacements(ANCHOR_IDS)) {
      const node = gltf.scene.getObjectByName(placement.node)!.clone(true);
      node.position.set(...placement.at);
      node.rotation.y = placement.rotationY;
      node.scale.set(...(placement.scale ?? [1, 1, 1]));
      node.updateMatrixWorld(true);
      const box = new Box3().setFromObject(node);
      expectIndoor(box);
      expectSolidFootprint(box);
      if (placement.node === 'desk' || placement.node === 'chair' || placement.node === 'vault_body') {
        expect(box.min.y, placement.id).toBeCloseTo(0, 2);
      }
      if (placement.node === 'monitor' || placement.node === 'keyboard') {
        expect(box.min.y, placement.id).toBeCloseTo(0.91, 2);
      }
    }
    const { x, z } = TREASURY_VAULT;
    expect(insideAny([x, z - 0.77], colliders, 0)).toBe(true);
    const stop = movePlayer([x, z - 2], [0, 2], colliders, PLAYER_RADIUS);
    expect(stop[1]).toBeLessThanOrEqual(z - 0.77 - PLAYER_RADIUS);
    expect(insideAny(stop, colliders, PLAYER_RADIUS)).toBe(false);
  });
});
