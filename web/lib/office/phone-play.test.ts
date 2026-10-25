import { describe, expect, it } from 'vitest';
import { insideAny, interactCandidates, officeColliders, pickTarget, PLAYER_RADIUS, targetLabel, type Vec2 } from './play';
import { createMockOfficeState } from './preview';
import { OFFICE_ANCHORS } from './state';
import { PHONE_INTERACTION } from './props/phone';
import { ANCHOR_IDS } from './layout';

/** Search actual collision-free approaches, with every business target competing. */
function approach(target: 'phone' | 'desk'): Vec2 | undefined {
  const center = target === 'phone' ? PHONE_INTERACTION.position : OFFICE_ANCHORS.collections.center;
  const boxes = officeColliders(ANCHOR_IDS);
  const candidates = interactCandidates([], ANCHOR_IDS);
  for (const radius of [0.8, 1.1, 1.4]) for (let i = 0; i < 32; i++) {
    const angle = i * Math.PI / 16;
    const point: Vec2 = [center[0] + Math.sin(angle) * radius, center[1] + Math.cos(angle) * radius];
    if (insideAny(point, boxes, PLAYER_RADIUS)) continue;
    const yaw = Math.atan2(point[0] - center[0], point[1] - center[1]);
    if (pickTarget(point, yaw, candidates)?.kind === target) return point;
  }
}

describe('desk phone in the shared pods', () => {
  it('has a collision-free approach that offers the phone with all business targets present', () => {
    expect(approach('phone')).toBeDefined();
    const snapshot = createMockOfficeState().source.getSnapshot();
    expect(targetLabel(snapshot, { kind: 'phone' })).toBe('Use desk phone');
  });
  it('keeps the desk inspectable and hides the phone when Collections is absent', () => {
    expect(approach('desk')).toBeDefined();
    expect(interactCandidates([], ['payables']).some(candidate => candidate.target.kind === 'phone')).toBe(false);
  });
});
