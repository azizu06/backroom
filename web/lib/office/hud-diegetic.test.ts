import { describe, expect, it } from 'vitest';
import { INITIAL_OFFICE, type OfficeAgent, type OfficeSnapshot } from './state';
import { PALETTE, ROLES } from './palette';
import { PLATE_TONES, deskPlate, deskPlateKey, deskPlates, noticeBoard } from './hud-diegetic';

const row = (id: string, decision: string, agentId = 'a') => ({ id, agentId, seatId: 'collections', action: 'review', decision,
  ruleIds: [`RULE_${id}`], summary: `summary ${id}` }) as (typeof INITIAL_OFFICE.audit)[number];
const alex: OfficeAgent = { id: 'a', name: 'Alex', seatId: 'collections', targetAnchor: 'collections', pos: [-5, -1.8], state: 'Reviewing invoice 1042' };
const at = (agent: Partial<OfficeAgent>, extra: Partial<OfficeSnapshot> = {}): OfficeSnapshot =>
  ({ ...INITIAL_OFFICE, connection: 'live', agents: [{ ...alex, ...agent }], ...extra });

describe('diegetic desk plates', () => {
  it('hangs a working plate over the seat desk with the agent task', () => {
    const plate = deskPlate(at({}), alex);
    expect(plate).toMatchObject({ name: 'Alex', desk: 'Collections', task: 'Reviewing invoice 1042', tone: 'working', status: 'Working', at: [-5, -3] });
    expect(PLATE_TONES[plate.tone].color).toBe(PALETTE.mint);
  });

  it('prefers held over denied, denied over away, and marks a dropped connection stale', () => {
    expect(deskPlate(at({ escalationId: 'e', targetAnchor: 'dana' }), { ...alex, escalationId: 'e', targetAnchor: 'dana' }))
      .toMatchObject({ tone: 'held', status: 'Held for a human · folder to Dana’s desk' });
    const denied = at({ targetAnchor: 'payables' }, { audit: [row('1', 'DENY'), row('2', 'ALLOW', 'other')] });
    expect(deskPlate(denied, denied.agents[0]!)).toMatchObject({ tone: 'denied', status: 'Denied · RULE_1' });
    expect(PLATE_TONES.denied.color).toBe(ROLES.deny);
    const away = at({ targetAnchor: 'payables' }, { audit: [row('1', 'DENY'), row('2', 'ALLOW')] });
    expect(deskPlate(away, away.agents[0]!)).toMatchObject({ tone: 'away', status: 'Away · at Payables' });
    const stale = at({ escalationId: 'e' }, { connection: 'disconnected' });
    expect(deskPlate(stale, stale.agents[0]!).tone).toBe('stale');
  });

  it('changes its redraw key only when painted text changes', () => {
    const [first] = deskPlates(at({}));
    const [same] = deskPlates(at({ rowAt: 99 }));
    const [moved] = deskPlates(at({ state: 'Sending reminder' }));
    expect(deskPlateKey(first!)).toBe(deskPlateKey(same!));
    expect(deskPlateKey(first!)).not.toBe(deskPlateKey(moved!));
  });
});

describe('diegetic lobby notice board', () => {
  it('shows today counts and the newest decisions first, capped', () => {
    const board = noticeBoard({ ...at({ escalationId: 'e' }), inboxCount: 3, connection: 'preview',
      audit: [row('1', 'ALLOW'), row('2', 'DENY'), row('3', 'ESCALATE'), row('4', 'RECORDED'), row('5', 'ALLOW')] }, 3);
    expect(board.mode).toBe('Preview');
    expect(board.stats.map(stat => [stat.label, stat.value, stat.alert])).toEqual([
      ['Inbox', 3, false], ['Held', 1, true], ['Denied', 1, true], ['Escalations', 1, true]]);
    expect(board.happened.map(entry => entry.id)).toEqual(['5', '4', '3']);
  });

  it('says why it is empty', () => {
    expect(noticeBoard(INITIAL_OFFICE).happened).toEqual([]);
    expect(noticeBoard({ ...INITIAL_OFFICE, connection: 'connecting' }).empty).toBe('Waiting for office state…');
  });
});
