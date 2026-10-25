import { describe, expect, it } from 'vitest';
import { OPEN_DOORS, doorAngle, doorCollider, INTERIOR_DOORS, toggleDoor } from './doors';
import { INITIAL_FOLDER, interactionLabel, pickUpFolder, putDownFolder } from './folder';
import { createInteractionStore, interactionStore } from './interactions';
import { interactCandidates, movePlayer, officeColliders, pickTarget, PLAYER_RADIUS } from './play';
import { createMockOfficeState } from './preview';
import { OFFICE_ANCHORS, type AnchorId } from './state';
import { doorPosition } from './doors';
import { BUILDING, WALL_THICKNESS } from './layout';
import { PAYLINK_KIOSK as K, TREASURY_DOOR } from './play';

const [X, D] = doorPosition('payables');

const rooms = Object.keys(OFFICE_ANCHORS) as AnchorId[];

describe('local interior doors', () => {
  it('toggles each interior door independently and preserves the input', () => {
    for (const room of INTERIOR_DOORS) {
      const closed = toggleDoor(OPEN_DOORS, room);
      expect(closed[room]).toBe(false);
      expect(OPEN_DOORS[room]).toBe(true);
      expect(toggleDoor(closed, room)).toEqual(OPEN_DOORS);
      expect(doorCollider(OPEN_DOORS, room)).toBeNull();
      expect(doorCollider(closed, room)).not.toBeNull();
    }
  });

  it('blocks a closed doorway, releases it when open and blocks again when closed', () => {
    for (const room of INTERIOR_DOORS) {
      const [x, door] = doorPosition(room);
      const closedState = toggleDoor(OPEN_DOORS, room);
      const closed = officeColliders(rooms, [], closedState);
      const open = officeColliders(rooms, [], toggleDoor(closedState, room));
      expect(officeColliders(rooms)).toEqual(open);
      expect(movePlayer([x, door + 1.05], [0, -1.7], closed)[1]).toBeCloseTo(door + 0.06 + PLAYER_RADIUS, 3);
      expect(movePlayer([x, door + 1.05], [0, -1.7], open)[1]).toBeCloseTo(door - 0.65);
      expect(movePlayer([x, door - 0.65], [0, 1.7], closed)[1]).toBeCloseTo(door - 0.06 - PLAYER_RADIUS, 3);
    }
  });

  it('never opens the Treasury barrier when every interior door is open', () => {
    const colliders = officeColliders(rooms, [], OPEN_DOORS);
    const [x, z] = TREASURY_DOOR;
    expect(movePlayer([x, z - 1.1], [0, 3], colliders)[1]).toBeCloseTo(z - WALL_THICKNESS / 2 - PLAYER_RADIUS, 3);
  });

  it('lets a player stopped on either side reopen a closed door with an agent behind it', () => {
    interactionStore.toggleDoor('payables');
    try {
      const candidates = interactCandidates([{ id: 'sam', position: [X, D - 1.15] }], rooms);
      for (const z of [D + 0.34, D - 0.34]) {
        const yaw = Math.atan2(-0.15, -(D - z));
        expect(pickTarget([X - 0.15, z], yaw, candidates)).toEqual({ kind: 'door', room: 'payables' });
      }
      // Targets on the player's side still win when they are nearer than the closed leaf.
      const nearer = interactCandidates([{ id: 'near', position: [X, D + 0.75] }], rooms);
      expect(pickTarget([X, D + 1.05], 0, nearer)).toEqual({ kind: 'agent', id: 'near' });
    } finally {
      interactionStore.toggleDoor('payables');
    }
  });

  it('targets the closed leaf away from its centre on both sides instead of an agent behind it', () => {
    interactionStore.toggleDoor('payables');
    try {
      const candidates = interactCandidates([{ id: 'sam', position: [X, D - 1.15] }], rooms);
      // The crosshair is on the leaf 0.35 left of its centre, outside the old centre-only aim cone.
      expect(pickTarget([X - 0.35, D + 0.34], 0, candidates)).toEqual({ kind: 'door', room: 'payables' });
      expect(pickTarget([X - 0.35, D - 0.34], Math.PI, candidates)).toEqual({ kind: 'door', room: 'payables' });
    } finally {
      interactionStore.toggleDoor('payables');
    }
    const open = interactCandidates([{ id: 'sam', position: [X, D - 1.15] }], rooms);
    // The open leaf lies beside the frame at (X - 0.65, D + 0.65).
    for (const dz of [0, -1.05, -0.31, -0.99]) {
      const yaw = Math.atan2(0.5, dz);
      expect(pickTarget([X - 0.15, D + 0.65 + dz], yaw, open)).toEqual({ kind: 'door', room: 'payables' });
    }
  });

  it('animates in both directions and snaps immediately under reduced motion', () => {
    const halfway = doorAngle(0, true, 0.1, false);
    expect(halfway).toBeLessThan(0);
    expect(halfway).toBeGreaterThan(-Math.PI / 2);
    expect(doorAngle(halfway, false, 0.02, false)).toBeGreaterThan(halfway);
    expect(doorAngle(halfway, true, 1, false)).toBe(-Math.PI / 2);
    expect(doorAngle(0, true, 0, true)).toBe(-Math.PI / 2);
    expect(doorAngle(-Math.PI / 2, false, 0, true)).toBe(0);
  });
});

describe('cosmetic folder', () => {
  it('picks up and puts down without modifying office state or another viewer', () => {
    const snapshot = createMockOfficeState().source.getSnapshot();
    const before = JSON.stringify(snapshot);
    const first = createInteractionStore(), other = createInteractionStore();
    expect(first.getSnapshot().doors).toEqual(OPEN_DOORS);
    let changes = 0;
    const unsubscribe = first.subscribe(() => { changes++; });
    first.pickUp();
    expect(first.getSnapshot().folder).toBeNull();
    first.pickUp(); // Already held: no second item or notification.
    expect(changes).toBe(1);
    first.putDown([K[0], K[1] - 1.1], Math.PI, rooms);
    expect(first.getSnapshot().folder?.position[1]).toBe(0.8);
    expect(other.getSnapshot().folder).toEqual(INITIAL_FOLDER);
    expect(JSON.stringify(snapshot)).toBe(before);
    unsubscribe();
    first.pickUp();
    expect(changes).toBe(2);
  });

  it('chooses the nearest surface ahead, keeps the folder on it, and otherwise uses the floor', () => {
    expect(pickUpFolder()).toBeNull();
    const eye = [K[0], K[1] - 1.1] as const;
    const counter = putDownFolder(eye, Math.PI, rooms);
    expect(counter.room).toBe('lobby');
    expect(counter.position[1]).toBe(0.8);
    expect(counter.position[2]).toBeGreaterThanOrEqual(K[1] - 0.31);
    const [px, pz] = OFFICE_ANCHORS.payables.center;
    expect(putDownFolder([px, pz + 1.2], 0, rooms)).toMatchObject({ room: 'payables', position: [px, 0.93, expect.any(Number)] });
    const floor = putDownFolder(eye, 0, rooms);
    expect(floor.room).toBeNull();
    expect(floor.position[0]).toBe(eye[0]);
    expect(floor.position[1]).toBe(0.025);
    expect(floor.position[2]).toBeCloseTo(eye[1] - 0.8, 9);
    expect(putDownFolder(eye, Math.PI, [])).toMatchObject({ room: null });
    expect(putDownFolder([BUILDING.maxX - 0.3, 0], -Math.PI / 2, rooms).position[0]).toBe(BUILDING.maxX - 0.2);
  });

  it('offers putting down only when held and no world target takes priority', () => {
    expect(interactionLabel(null, INITIAL_FOLDER)).toBeNull();
    expect(interactionLabel(null, null)).toBe('Put down folder');
    expect(interactionLabel('Open door', null)).toBe('Open door');
    expect(interactionLabel('Treasury door', null)).toBe('Treasury door');
  });
});
