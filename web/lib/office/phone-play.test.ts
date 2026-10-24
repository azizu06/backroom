import { describe, expect, it } from 'vitest';
import { applyLook, applyTurnTap, insideAny, interactCandidates, movePlayer, officeColliders, pickTarget, PLAYER_RADIUS, PlayInput, SPAWN, targetLabel, TURN_SPEED } from './play';
import { createMockOfficeState } from './preview';
import { OFFICE_ANCHORS } from './state';
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
    const candidates = interactCandidates(playRigAgents, ['collections']);
    // Match office-phone.spec.ts: walk into the desk, then strafe toward the handset.
    // The aisle pedestal stops that strafe on the phone instead of letting it slide to the partition.
    const colliders = officeColliders(['lobby', 'collections', 'payables', 'vendor_onboarding', 'dana', 'treasury']);
    let eye: readonly [number, number] = SPAWN.position;
    for (let i = 0; i < 400 && eye[1] > -2.5; i++) {
      const next = movePlayer(eye, [0, -0.03], colliders);
      if (next[1] === eye[1]) break;
      eye = next;
    }
    for (let i = 0; i < 200; i++) {
      const next = movePlayer(eye, [0.03, 0], colliders);
      if (next[0] === eye[0]) break;
      eye = next;
    }
    expect(Math.abs(eye[0] - -4.2)).toBeLessThan(0.08);
    expect(pickTarget(eye, 0, candidates)).toEqual({ kind: 'phone' });

    // The browser spec releases W as soon as z < -1, then strafes. That pass is still in the aisle.
    let aisle: readonly [number, number] = SPAWN.position;
    for (let i = 0; i < 400 && aisle[1] > -1.5; i++) aisle = movePlayer(aisle, [0, -0.02], colliders);
    expect(aisle[1]).toBeLessThan(-1);
    expect(aisle[1]).toBeGreaterThan(-1.8);
    for (let i = 0; i < 200; i++) {
      const next = movePlayer(aisle, [0.05, 0], colliders);
      if (next[0] === aisle[0]) break;
      aisle = next;
    }
    expect(Math.abs(aisle[0] - -4.2)).toBeLessThan(0.08);
    expect(pickTarget(aisle, 0, candidates)).toEqual({ kind: 'phone' });
    // The rail stays east of the doorway, so the player can still leave collections going north.
    let through: readonly [number, number] = [-5, -1.2];
    for (let i = 0; i < 80; i++) through = movePlayer(through, [0, 0.05], colliders);
    expect(through[1]).toBeGreaterThan(-0.5);
    const phone = PHONE_INTERACTION.position;
    const yaw = Math.atan2(-(phone[0] - eye[0]), -(phone[1] - eye[1]));
    expect(pickTarget(eye, yaw, candidates)).toEqual({ kind: 'phone' });

    const deskEye: [number, number] = [-5, -1.9];
    expect(pickTarget(deskEye, 0, candidates)).toEqual({ kind: 'desk', room: 'collections' });
  });

  it('faces the handset from the desk face with turn-key taps', () => {
    const playRigAgents = createMockOfficeState().source.getSnapshot().agents.map(agent => ({ id: agent.id, position: agent.pos }));
    const candidates = interactCandidates(playRigAgents, ['lobby', 'collections', 'payables', 'vendor_onboarding', 'dana', 'treasury'] as const);
    const phone = PHONE_INTERACTION.position;
    // Where the browser walk stops: against the collections desk, still left of the handset, yaw 0 (the desk wins).
    const stand: [number, number] = [-4.941, -2.195];
    expect(pickTarget(stand, 0, candidates)).toEqual({ kind: 'desk', room: 'collections' });
    const input = new PlayInput();
    let yaw = 0;
    for (let i = 0; i < 40; i++) {
      const angle = Math.atan2(-(phone[0] - stand[0]), -(phone[1] - stand[1]));
      const diff = Math.atan2(Math.sin(angle - yaw), Math.cos(angle - yaw));
      if (Math.abs(diff) <= 0.06) break;
      applyTurnTap(input, diff > 0 ? 'turnLeft' : 'turnRight');
      yaw = applyLook(yaw, 0, input.consumeTurnTap(), 0).yaw;
    }
    expect(Math.abs(yaw)).toBeGreaterThan(TURN_SPEED / 60);
    expect(pickTarget(stand, yaw, candidates)).toEqual({ kind: 'phone' });
  });
});
