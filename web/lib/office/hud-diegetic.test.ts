import { describe, expect, it } from 'vitest';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type OfficeAgent, type OfficeSnapshot } from './state';
import { PALETTE, ROLES } from './palette';
import { PLATE_TONES, canvasTextLines, deskPlate, deskPlateKey, deskPlates, noticeBoard } from './hud-diegetic';

describe('shared measured canvas text', () => {
  // Deliberately variable glyph widths: a character limit cannot pass these cases reliably.
  const measure = (text: string) => [...text].reduce((sum, ch) => sum + (ch === ' ' ? 4 : /[ilI.·]/.test(ch) ? 3 : /[MW]/.test(ch) ? 12 : 8), 0);
  it.each([
    ['Jules · Checking vendor evidence', 130, 2],
    ['Preview · sample tickets from the office snapshot', 140, 3],
    ['Alex · Reviewing invoice 1042', 120, 2],
    ['Ask me about issues/PRs', 100, 2],
  ] as const)('wraps the complete demo text: %s', (text, width, maxLines) => {
    const lines = canvasTextLines(text, measure, width, maxLines);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.length).toBeLessThanOrEqual(maxLines);
    expect(lines.join(' ')).toBe(text);
    expect(lines.every(line => measure(line) <= width)).toBe(true);
  });
  it('ellipsizes only the last available line and respects measured width', () => {
    const lines = canvasTextLines('Preview · sample tickets from the office snapshot and more details', measure, 100, 3);
    expect(lines).toHaveLength(3);
    expect(lines.slice(0, -1).every(line => !line.includes('…'))).toBe(true);
    expect(lines[2]!.endsWith('…')).toBe(true);
    expect(lines.every(line => measure(line) <= 100)).toBe(true);
  });
  it('handles exact fits, long identifiers, whitespace and unusable bounds', () => {
    expect(canvasTextLines('invoice', measure, measure('invoice'), 2)).toEqual(['invoice']);
    expect(canvasTextLines('  Alex\n  reviewing ', measure, 50, 3).join('')).toBe('Alexreviewing');
    expect(canvasTextLines('WWWWWW', measure, 24, 3)).toEqual(['WW', 'WW', 'WW']);
    expect(canvasTextLines('Alex', measure, 0, 2)).toEqual([]);
    expect(canvasTextLines('Alex', measure, 100, 0)).toEqual([]);
    expect(canvasTextLines('Alex', measure, 100, NaN)).toEqual([]);
    expect(canvasTextLines('', measure, 100, 3)).toEqual([]);
  });
});

const row = (id: string, decision: string, agentId = 'a') => ({ id, agentId, seatId: 'collections', action: 'review', decision,
  ruleIds: [`RULE_${id}`], summary: `summary ${id}` }) as (typeof INITIAL_OFFICE.audit)[number];
const alex: OfficeAgent = { id: 'a', name: 'Alex', seatId: 'collections', targetAnchor: 'collections', pos: [-5, -1.8], state: 'Reviewing invoice 1042' };
const at = (agent: Partial<OfficeAgent>, extra: Partial<OfficeSnapshot> = {}): OfficeSnapshot =>
  ({ ...INITIAL_OFFICE, connection: 'live', agents: [{ ...alex, ...agent }], ...extra });

describe('diegetic desk plates', () => {
  it('hangs a working plate over the seat desk with the agent task', () => {
    const plate = deskPlate(at({}), alex);
    expect(plate).toMatchObject({ name: 'Alex', desk: 'Collections', task: 'Reviewing invoice 1042', tone: 'working', status: 'Working', at: [...OFFICE_ANCHORS.collections.center] });
    expect(PLATE_TONES[plate.tone].color).toBe(PALETTE.mint);
  });

  it('prefers held over denied, denied over away, and marks a dropped connection stale', () => {
    expect(deskPlate(at({ escalationId: 'e', targetAnchor: 'dana' }), { ...alex, escalationId: 'e', targetAnchor: 'dana' }))
      .toMatchObject({ tone: 'held', status: 'Held for a human · folder to Dana’s Desk' });
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
    expect(board.mode).toBeUndefined();
    expect(board.stats.map(stat => [stat.label, stat.value, stat.alert])).toEqual([
      ['Inbox', 3, false], ['Held', 1, true], ['Denied', 1, true], ['Escalations', 1, true]]);
    expect(board.happened.map(entry => entry.id)).toEqual(['5', '4', '3']);
  });

  it('says why it is empty', () => {
    expect(noticeBoard(INITIAL_OFFICE).happened).toEqual([]);
    expect(noticeBoard({ ...INITIAL_OFFICE, connection: 'connecting' }).empty).toBe('Waiting for office state…');
  });
});
