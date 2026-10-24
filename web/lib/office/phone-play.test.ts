import { describe, expect, it } from 'vitest';
import { insideAny, interactCandidates, movePlayer, officeColliders, pickTarget, PLAYER_RADIUS, SPAWN, targetLabel } from './play';
import { createMockOfficeState } from './preview';
import { OFFICE_ANCHORS, visibleRooms } from './state';
import { PHONE_INTERACTION } from './props/phone';

describe('desk phone Play targeting', () => {
  const agents: { id: string; position: readonly [number, number] }[] = [];
  it('wins when aimed at the phone from the aisle side', () => {
    const snapshot = createMockOfficeState().source.getSnapshot();
    const rooms = ['collections'] as const;
    const stand: [number, number] = [-4.15, -2.15];
    const phone = [-4.15, -2.7] as const;
    const colliders = officeColliders(['collections']);
    expect(insideAny(stand, colliders, PLAYER_RADIUS)).toBe(false);
    const moved = movePlayer(stand, [0, -0.01], colliders);
    expect(moved[0]).toBeCloseTo(-4.15);
    expect(moved[1]).toBeCloseTo(-2.16);
    expect(insideAny(moved, colliders, PLAYER_RADIUS)).toBe(false);
    const yaw = Math.atan2(-(phone[0] - stand[0]), -(phone[1] - stand[1]));
    const target = pickTarget(stand, yaw, interactCandidates(agents, rooms));
    expect(target).toEqual({ kind: 'phone' });
    expect(targetLabel(snapshot, target!)).toBe('Use desk phone');
  });
  it('keeps the desk pickable at its other end and omits phone when the room is hidden', () => {
    const candidates = interactCandidates(agents, ['collections']);
    expect(pickTarget([-5.8, -2.1], Math.atan2(-0.8, 0.9), candidates)).toEqual({ kind: 'desk', room: 'collections' });
    expect(interactCandidates(agents, ['payables']).some(item => item.target.kind === 'phone')).toBe(false);
    expect(OFFICE_ANCHORS.collections.center).toEqual([-5, -3]);
  });
  it('picks the phone from the natural aisle stop with the PlayRig candidate set, while preserving desk centre pick', () => {
    const snapshot = createMockOfficeState().source.getSnapshot();
    // PlayRig candidates use the motion positions. Preview motions begin at these snapshot positions.
    const playRigAgents = snapshot.agents.map(agent => ({ id: agent.id, position: agent.pos }));
    const candidates = interactCandidates(playRigAgents, visibleRooms(snapshot));
    // Match office-phone.spec.ts: walk through the doorway, strafe to x=-4.2, then approach the desk.
    const colliders = officeColliders(['collections']);
    let eye: readonly [number, number] = SPAWN.position;
    while (eye[1] >= -1.0) eye = movePlayer(eye, [0, -0.03], colliders);
    while (eye[0] < -4.2 - 0.08) eye = movePlayer(eye, [0.03, 0], colliders);
    while (eye[1] >= -1.9) eye = movePlayer(eye, [0, -0.03], colliders);
    const phone = PHONE_INTERACTION.position;
    const yaw = Math.atan2(-(phone[0] - eye[0]), -(phone[1] - eye[1]));
    for (const offset of [-0.2, 0, 0.2]) {
      const target = pickTarget(eye, yaw + offset, candidates);
      expect(target).toEqual({ kind: 'phone' });
      expect(targetLabel(snapshot, target!)).toBe('Use desk phone');
    }

    const deskEye: [number, number] = [-5, -1.9];
    expect(pickTarget(deskEye, 0, candidates)).toEqual({ kind: 'desk', room: 'collections' });
  });
});
