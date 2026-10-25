// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cameraAlpha, doorHighlight, isCloseKey, legSwing, REDUCED_MOTION_QUERY, roomLabel, seatLabel } from './a11y';
import { INITIAL_OFFICE, type OfficeAgent, type OfficeSnapshot } from './state';

const agent: OfficeAgent = {
  id: 'collections_1', name: 'Alex', seatId: 'collections', targetAnchor: 'dana',
  pos: [-5, -1.8], state: 'working',
};
const snapshot: OfficeSnapshot = {
  ...INITIAL_OFFICE,
  badges: [{ seatId: 'payables', policyVersion: 3, actions: [], rooms: [], limits: {} }],
  denials: [{ room: 'treasury', agentId: agent.id, auditId: 'denial-1', at: 123 }],
  audit: [{ id: 'denial-1', agentId: agent.id, seatId: agent.seatId, room: 'treasury',
    action: 'request_room_entry', decision: 'DENY', ruleIds: ['NOT_IN_BADGE'], summary: 'Denied' }],
};

describe('a11y names', () => {
  it('includes the agent name and state, and the folder target only when escalating', () => {
    expect(seatLabel(agent)).toBe('Alex, working');
    expect(seatLabel({ ...agent, escalationId: 'escalation-1' }))
      .toBe('Alex, working, escalation folder to Dana’s Desk');
    expect(seatLabel({ ...agent, escalationId: 'escalation-1', targetAnchor: 'payables' }))
      .toContain('escalation folder to Payables');
  });

  it('names badge versions and room functions', () => {
    expect(roomLabel('payables', snapshot)).toBe('Payables · badge v3 · open limits');
    expect(roomLabel('lobby', snapshot)).toBe('Lobby · audit wall and inbox');
    expect(roomLabel('dana', snapshot)).toBe('Dana’s Desk · human approval');
    expect(roomLabel('treasury', INITIAL_OFFICE)).toBe('Treasury · locked, Dana only');
    expect(roomLabel('collections', INITIAL_OFFICE)).toBe('Collections · open details');
  });

  it('announces only a denial backed by the matching server audit receipt', () => {
    expect(roomLabel('treasury', snapshot)).toBe('Treasury · locked, Dana only · entry denied');
    expect(roomLabel('payables', snapshot)).not.toContain('entry denied');
    expect(roomLabel('treasury', { ...snapshot, audit: [] })).not.toContain('entry denied');
    expect(roomLabel('treasury', { ...snapshot, audit: [{ ...snapshot.audit[0]!, agentId: 'other' }] }))
      .not.toContain('entry denied');
  });
});

describe('inspector close keys', () => {
  it('accepts Escape and the legacy Esc spelling only', () => {
    expect(isCloseKey('Escape')).toBe(true);
    expect(isCloseKey('Esc')).toBe(true);
    for (const key of ['Enter', 'Tab', ' ', 'escape', '']) expect(isCloseKey(key)).toBe(false);
  });
});

describe('office reduced motion', () => {
  it('uses the system reduced-motion preference', () => {
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
  });

  it('snaps the camera under reduced motion and preserves the default clamped tween', () => {
    for (const delta of [0, 1 / 60, 0.1, 10]) {
      expect(cameraAlpha(delta, true)).toBe(1);
      expect(cameraAlpha(delta, false)).toBe(1 - Math.exp(-7 * Math.min(delta, 0.1)));
    }
  });

  it('keeps a steady reduced-motion denial highlight and preserves the default flash', () => {
    for (const age of [0, 299, 300, 599, 600, 4499]) {
      expect(doorHighlight(age, true)).toEqual({ visible: true, opacity: 0.8 });
      expect(doorHighlight(age, false)).toEqual({ visible: true, opacity: Math.floor(age / 300) % 2 === 0 ? 0.95 : 0.65 });
    }
    for (const age of [-1, 4500, 5000, Infinity]) {
      expect(doorHighlight(age, true).visible).toBe(false);
      expect(doorHighlight(age, false)).toEqual({ visible: false, opacity: 0.65 });
    }
  });

  it('disables leg swing when reduced or stationary and preserves walking swing otherwise', () => {
    for (const distance of [0, 0.1, 1, 12]) for (const i of [0, 1]) {
      expect(legSwing(distance, i, true, false)).toBe(Math.sin(distance * 9 + i * Math.PI) * 0.38);
      expect(legSwing(distance, i, true, true)).toBe(0);
      expect(legSwing(distance, i, false, false)).toBe(0);
      expect(legSwing(distance, i, false, true)).toBe(0);
    }
  });
});
