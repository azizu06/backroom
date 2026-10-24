import { describe, expect, it } from 'vitest';
import { insideAny, interactCandidates, movePlayer, officeColliders, pickTarget, PLAYER_RADIUS, targetLabel } from './play';
import { createMockOfficeState } from './preview';
import { OFFICE_ANCHORS } from './state';

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
});
