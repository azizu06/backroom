import { describe, expect, it } from 'vitest';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type OfficeAudit, type OfficeDenial, type OfficeSnapshot } from '../state';
import { DENY_MOMENT_MS, ECHO_OPACITY, ECHO_START, ECHO_WALK, TREASURY_DOOR_INTERACTION, createDenyPose, denyMoment, denyPose } from './treasuryDeny';

const AT = 1_000_000;
const denial: OfficeDenial = { room: 'treasury', agentId: 'collections-clerk', auditId: 'audit-7', at: AT };
const row = (patch: Partial<OfficeAudit> = {}): OfficeAudit => ({
  id: 'audit-7', agentId: 'collections-clerk', seatId: 'collections', room: 'treasury', action: 'request_room_entry',
  decision: 'DENY', ruleIds: ['NOT_IN_BADGE', 'CONTROLLER_ONLY'], summary: 'Treasury entry refused', ...patch,
});
const base: OfficeSnapshot = {
  ...INITIAL_OFFICE, connection: 'preview',
  agents: [{ id: 'collections-clerk', name: 'Alex', seatId: 'collections', targetAnchor: 'collections', pos: [-5, -1.8], state: 'working' }],
};
const denied = (patch: Partial<OfficeSnapshot> = {}): OfficeSnapshot => ({ ...base, denials: [denial], audit: [row()], ...patch });

describe('denyMoment', () => {
  it('is null without a matching treasury denial', () => {
    expect(denyMoment(base, AT, false)).toBeNull();
    expect(denyMoment(denied({ audit: [] }), AT, false)).toBeNull();
    expect(denyMoment(denied({ audit: [row({ id: 'other' })] }), AT, false)).toBeNull();
    expect(denyMoment(denied({ audit: [row({ decision: 'ALLOW' })] }), AT, false)).toBeNull();
    expect(denyMoment(denied({ denials: [{ ...denial, room: 'payables' }] }), AT, false)).toBeNull();
  });

  it('ends after DENY_MOMENT_MS and clamps future timestamps to age 0', () => {
    expect(denyMoment(denied(), AT + DENY_MOMENT_MS, false)).toBeNull();
    expect(denyMoment(denied(), AT + DENY_MOMENT_MS + 1, true)).toBeNull();
    expect(denyMoment(denied(), AT + DENY_MOMENT_MS - 1, false)?.active).toBe(true);
    const future = denyMoment(denied(), AT - 60_000, false);
    expect(future).toEqual(denyMoment(denied(), AT, false));
    expect(future?.echo).toMatchObject({ z: ECHO_START[1], heading: 0 });
  });

  it('reads the agent, seat color and rule from the server receipt', () => {
    expect(denyMoment(denied(), AT, false)).toMatchObject({
      auditId: 'audit-7', agentId: 'collections-clerk', agentName: 'Alex', color: OFFICE_ANCHORS.collections.color,
      rule: 'NOT_IN_BADGE', signText: 'DENIED · NOT_IN_BADGE', active: true,
    });
    const unknown = denyMoment(denied({ agents: [], audit: [row({ ruleIds: [], seatId: 'mystery' })] }), AT, false);
    expect(unknown).toMatchObject({ agentName: 'collections-clerk', color: '#9aa38f', rule: 'DENIED', signText: 'DENIED · DENIED' });
  });

  it('plays the echo: faces the door, turns, then walks back toward the aisle and fades', () => {
    const at = (fraction: number) => denyMoment(denied(), AT + fraction * DENY_MOMENT_MS, false)!;
    expect(at(0).echo).toEqual({ x: ECHO_START[0], z: ECHO_START[1], heading: 0, opacity: ECHO_OPACITY });
    expect(at(0.3).echo).toMatchObject({ z: ECHO_START[1], heading: 0 });
    const turning = at(0.5).echo;
    expect(turning.z).toBe(ECHO_START[1]);
    expect(turning.heading).toBeGreaterThan(Math.PI / 2);
    expect(turning.heading).toBeLessThanOrEqual(Math.PI);
    expect(at(0.56).echo.heading).toBe(Math.PI);
    const end = at(0.999).echo;
    expect(end.z).toBeLessThan(ECHO_START[1] - ECHO_WALK + 0.01);
    expect(end.opacity).toBeLessThan(0.01);
    for (let i = 11; i < 19; i++) expect(at((i + 1) / 20).echo.z).toBeLessThanOrEqual(at(i / 20).echo.z);
  });

  it('pulses the ring a few times, then fades it, and fades the sign in and out', () => {
    const pulses = Array.from({ length: 400 }, (_, i) => denyMoment(denied(), AT + i * 10, false)!.pulse);
    for (const pulse of pulses) { expect(pulse).toBeGreaterThanOrEqual(0); expect(pulse).toBeLessThanOrEqual(1); }
    const peaks = pulses.filter((pulse, i) => i > 0 && i < pulses.length - 1 && pulse > pulses[i - 1]! && pulse >= pulses[i + 1]!);
    expect(peaks.length).toBeGreaterThanOrEqual(2);
    expect(pulses.at(-1)!).toBeLessThan(0.05);
    const sign = (fraction: number) => denyMoment(denied(), AT + fraction * DENY_MOMENT_MS, false)!.signOpacity;
    expect(sign(0)).toBe(0);
    expect(sign(0.03)).toBeGreaterThan(0);
    expect(sign(0.5)).toBe(1);
    expect(sign(0.999)).toBeLessThan(0.05);
  });

  it('under reduced motion holds the ring and sign and shows a still echo at its end pose', () => {
    const poses = Array.from({ length: 40 }, (_, i) => denyMoment(denied(), AT + i * 100, true)!);
    for (const pose of poses) {
      expect(pose.pulse).toBe(1);
      expect(pose.signOpacity).toBe(1);
      expect(pose.echo).toEqual({ x: ECHO_START[0], z: ECHO_START[1] - ECHO_WALK, heading: Math.PI, opacity: ECHO_OPACITY });
    }
    expect(denyMoment(denied(), AT + DENY_MOMENT_MS, true)).toBeNull();
  });
});

describe('denyPose', () => {
  it('writes into a reused pose and settles after the moment', () => {
    const out = createDenyPose();
    expect(denyPose(1000, false, out)).toBe(out);
    expect(denyPose(DENY_MOMENT_MS, false, out)).toMatchObject({ pulse: 0, signOpacity: 0, echo: { opacity: 0 } });
  });
});

describe('TREASURY_DOOR_INTERACTION', () => {
  it('is visible only with the treasury room', () => {
    expect(TREASURY_DOOR_INTERACTION.visible({ ...base, rooms: undefined })).toBe(true);
    expect(TREASURY_DOOR_INTERACTION.visible({ ...base, rooms: [{ id: 'treasury', rowId: 'r' }] })).toBe(true);
    expect(TREASURY_DOOR_INTERACTION.visible({ ...base, rooms: [{ id: 'lobby', rowId: 'r' }] })).toBe(false);
  });

  it('shows the lock without a denial and the server receipt with one', () => {
    expect(TREASURY_DOOR_INTERACTION.panel(base, AT)).toEqual({ title: 'Treasury door', rows: [{ label: 'Status', value: 'Locked · Dana only' }] });
    expect(TREASURY_DOOR_INTERACTION.panel(denied({ audit: [] }), AT).rows).toHaveLength(1);
    expect(TREASURY_DOOR_INTERACTION.panel(denied(), AT + 60_000)).toEqual({
      title: 'Treasury door',
      rows: [
        { label: 'Status', value: 'Locked · Dana only' },
        { label: 'Last attempt', value: 'Alex' },
        { label: 'Decision', value: 'DENY' },
        { label: 'Rules', value: 'NOT_IN_BADGE, CONTROLLER_ONLY' },
        { label: 'Audit', value: 'audit-7' },
      ],
    });
  });
});
