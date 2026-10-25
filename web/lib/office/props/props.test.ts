import { describe, expect, it } from 'vitest';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type AnchorId, type OfficeAudit, type OfficeSnapshot } from '../state';
import { OFFICE_PROP_INTERACTIONS, WHITEBOARD_INTERACTION, clockFace, msUntilNextMinute, propInteractions, whiteboardStats } from './index';
import { PHONE_INTERACTION } from './phone';
import { BUILDING } from '../layout';

const row = (id: string, decision: OfficeAudit['decision'], summary = `row ${id}`): OfficeAudit =>
  ({ id, agentId: 'payables-clerk', seatId: 'payables', action: 'pay_invoice', decision, ruleIds: [], summary });
const snapshot = (patch: Partial<OfficeSnapshot> = {}): OfficeSnapshot => ({ ...INITIAL_OFFICE, connection: 'preview', ...patch });
const withRooms = (...ids: AnchorId[]) => snapshot({ rooms: ids.map(id => ({ id, rowId: `row:${id}` })) });
const at = (hours: number, minutes: number) => new Date(2026, 9, 24, hours, minutes, 0, 0).getTime();

describe('whiteboardStats', () => {
  it('counts each decision, inbox, agents and connection', () => {
    const stats = whiteboardStats(snapshot({
      audit: [row('1', 'ALLOW'), row('2', 'ALLOW'), row('3', 'DENY'), row('4', 'ESCALATE'), row('5', 'RECORDED'), row('6', 'RECORDED'), row('7', 'RECORDED')],
      inboxCount: 4, connection: 'live',
      agents: [{ id: 'a', name: 'Sam', seatId: 'payables', targetAnchor: 'payables', pos: [0, 0], state: 'idle' }],
    }));
    expect(stats).toMatchObject({ allow: 2, deny: 1, escalate: 1, recorded: 3, total: 7, inbox: 4, agents: 1, connection: 'live' });
  });

  it('handles an empty audit', () => {
    expect(whiteboardStats(snapshot())).toEqual({
      allow: 0, deny: 0, escalate: 0, recorded: 0, total: 0, inbox: 0, agents: 0, connection: 'preview', recent: [],
    });
  });

  it('lists at most the 3 newest rows, newest first', () => {
    const stats = whiteboardStats(snapshot({ audit: ['a', 'b', 'c', 'd', 'e'].map(id => row(id, id === 'e' ? 'DENY' : 'ALLOW')) }));
    expect(stats.recent).toEqual([
      { decision: 'DENY', summary: 'row e' }, { decision: 'ALLOW', summary: 'row d' }, { decision: 'ALLOW', summary: 'row c' },
    ]);
    expect(whiteboardStats(snapshot({ audit: [row('x', 'ESCALATE')] })).recent).toHaveLength(1);
  });

  it('truncates long summaries with an ellipsis and keeps short ones intact', () => {
    const long = 'Invoice 1042 · four installments requested → Dana for approval';
    const [recent] = whiteboardStats(snapshot({ audit: [row('1', 'ESCALATE', long)] })).recent;
    expect(recent!.summary.length).toBeLessThanOrEqual(34);
    expect(recent!.summary.endsWith('…')).toBe(true);
    expect(long.startsWith(recent!.summary.slice(0, -1))).toBe(true);
    const exact = 'x'.repeat(34);
    expect(whiteboardStats(snapshot({ audit: [row('1', 'ALLOW', exact)] })).recent[0]!.summary).toBe(exact);
  });
});

describe('clockFace', () => {
  it('computes hand angles clockwise from 12', () => {
    expect(clockFace(at(0, 0))).toMatchObject({ hours: 0, minutes: 0, hourAngle: 0, minuteAngle: 0, text: '00:00' });
    const three = clockFace(at(3, 0));
    expect(three.hourAngle).toBeCloseTo(Math.PI / 2);
    expect(three.minuteAngle).toBe(0);
    const half = clockFace(at(6, 30));
    expect(half.hourAngle).toBeCloseTo(Math.PI * 13 / 12);
    expect(half.minuteAngle).toBeCloseTo(Math.PI);
    expect(clockFace(at(18, 30)).hourAngle).toBeCloseTo(half.hourAngle);
  });

  it('zero-pads 24h text', () => {
    expect(clockFace(at(7, 5)).text).toBe('07:05');
    expect(clockFace(at(23, 9)).text).toBe('23:09');
  });

  it('schedules the next tick on the minute boundary', () => {
    expect(msUntilNextMinute(60_000 * 5)).toBe(60_000);
    expect(msUntilNextMinute(60_000 * 5 + 59_000)).toBe(1_000);
  });
});

describe('office prop interactions', () => {
  const full = snapshot({ audit: [row('1', 'ALLOW'), row('2', 'DENY')], inboxCount: 2 });

  it('have unique ids and prompts', () => {
    const ids = OFFICE_PROP_INTERACTIONS.map(prop => prop.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const prop of OFFICE_PROP_INTERACTIONS) expect(prop.prompt.trim()).not.toBe('');
  });

  it('stand on the floor and outside every desk footprint', () => {
    const desks = (['collections', 'payables', 'vendor_onboarding', 'dana'] as const).map(room => OFFICE_ANCHORS[room].center);
    for (const { id, position: [x, z], radius } of OFFICE_PROP_INTERACTIONS) {
      expect(x, id).toBeGreaterThanOrEqual(BUILDING.minX);
      expect(x, id).toBeLessThanOrEqual(BUILDING.maxX);
      expect(z, id).toBeGreaterThanOrEqual(BUILDING.minZ);
      expect(z, id).toBeLessThanOrEqual(BUILDING.maxZ);
      expect(radius, id).toBeGreaterThan(0);
      if (id !== PHONE_INTERACTION.id) for (const [dx, dz] of desks) expect(Math.abs(x - dx) <= 2.25 / 2 && Math.abs(z - dz) <= 1.05 / 2, `${id} inside desk`).toBe(false);
    }
    expect(PHONE_INTERACTION.position).toEqual([OFFICE_ANCHORS.collections.center[0] + 0.85, OFFICE_ANCHORS.collections.center[1] + 0.3]);
  });

  it('build deterministic, non-empty panels', () => {
    const now = at(9, 41);
    for (const prop of OFFICE_PROP_INTERACTIONS) {
      const panel = prop.panel(full, now);
      expect(panel.title).not.toBe('');
      expect(panel.rows.length).toBeGreaterThan(0);
      for (const entry of panel.rows) expect(entry.label).not.toBe('');
      expect(prop.panel(full, now)).toEqual(panel);
    }
    expect(WHITEBOARD_INTERACTION.panel(full, now).rows).toContainEqual({ label: 'Deny', value: '1' });
    const held = snapshot({ audit: [row('h', 'ESCALATE', 'four installments')] });
    expect(WHITEBOARD_INTERACTION.panel(held, now).rows).toContainEqual({ label: 'Hold', value: 'four installments' });
  });

  it('hide the whiteboard without payables and the Treasury door without treasury', () => {
    // Desk monitors are covered in monitors.test.ts.
    const ids = (value: OfficeSnapshot) => propInteractions(value).map(prop => prop.id).filter(id => !id.startsWith('monitor:'));
    expect(ids(snapshot({ rooms: undefined }))).toEqual(['whiteboard', 'treasury-door', 'desk-phone']);
    expect(ids(withRooms())).toEqual([]);
    expect(ids(withRooms('payables'))).toEqual(['whiteboard']);
    expect(ids(withRooms('lobby'))).toEqual([]);
    expect(ids(withRooms('collections', 'treasury'))).toEqual(['treasury-door', 'desk-phone']);
    expect(ids(withRooms('dana', 'treasury', 'vendor_onboarding'))).toEqual(['treasury-door']);
  });
});
