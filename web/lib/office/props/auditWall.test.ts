import { describe, expect, it } from 'vitest';
import { INITIAL_OFFICE, type OfficeAudit, type OfficeSnapshot } from '../state';
import { AUDIT_WALL_MAX_ROWS, RECEIPT_ID_MAX, auditWallNotice, auditWallNoticeLines, auditWallText, auditWallView, auditWallVisible, shortReceipt } from './auditWall';

const row = (id: string, over: Partial<OfficeAudit> = {}): OfficeAudit =>
  ({ id, agentId: 'a', seatId: 'payables', action: 'pay', decision: 'ALLOW', ruleIds: [], summary: `row ${id}`, ...over });
const snap = (audit: OfficeAudit[], over: Partial<OfficeSnapshot> = {}): OfficeSnapshot => ({ ...INITIAL_OFFICE, audit, connection: 'live', ...over });

describe('audit wall rows', () => {
  it('lists the newest receipts first and caps the count', () => {
    const view = auditWallView(snap(Array.from({ length: 9 }, (_, i) => row(`r${i}`))));
    expect(view.total).toBe(9);
    expect(view.rows).toHaveLength(AUDIT_WALL_MAX_ROWS);
    expect(view.rows.map(r => r.receipt)).toEqual(['r8', 'r7', 'r6', 'r5', 'r4', 'r3']);
  });
  it('shows the receipt id for every row, shortening long ids to a fixed width', () => {
    expect(shortReceipt('preview-denial-1')).toBe('preview-denial-1');
    const long = 'audit_0123456789abcdef0123456789abcdef';
    const short = shortReceipt(long);
    expect(short).toHaveLength(RECEIPT_ID_MAX);
    expect(short.startsWith(long.slice(0, 10))).toBe(true);
    expect(short.endsWith(long.slice(-5))).toBe(true);
    expect(auditWallView(snap([row(long)])).rows[0]?.receipt).toBe(short);
  });
  it('truncates long summaries and keeps the decision', () => {
    const [first] = auditWallView(snap([row('x', { decision: 'DENY', summary: 'Treasury entry denied '.repeat(5) })])).rows;
    expect(first?.decision).toBe('DENY');
    expect(first?.summary.length).toBeLessThanOrEqual(38);
    expect(first?.summary.endsWith('…')).toBe(true);
  });
  it('mirrors the rows as text and handles an empty snapshot', () => {
    expect(auditWallText(auditWallView(snap([row('a'), row('b', { decision: 'ESCALATE' })])))).toBe('b ESCALATE row b\na ALLOW row a');
    expect(auditWallView(snap([])).rows).toEqual([]);
    expect(auditWallText(auditWallView(snap([])))).toBe('');
  });
  it('paints no rows for preview or replay feeds, which are not the audit log', () => {
    expect(auditWallNotice('preview')).toBe('Preview feed: no audit entries. Live receipts appear here; see /audit.');
    expect(auditWallNotice('replay')).toBe('Replay feed: no audit entries. Live receipts appear here; see /audit.');
    for (const connection of ['preview', 'replay'] as const) {
      const view = auditWallView(snap([row('preview-denial-1', { decision: 'DENY' })], { connection }));
      expect(view.rows).toEqual([]);
      expect(view.total).toBe(0);
      expect(view.notice).toBe(auditWallNotice(connection));
      expect(auditWallNoticeLines(view.notice!).join(' ')).toBe(view.notice);
      expect(auditWallText(view)).toBe('');
    }
    for (const connection of ['live', 'connecting', 'disconnected'] as const) {
      const view = auditWallView(snap([row('a')], { connection }));
      expect(view.rows).toHaveLength(1);
      expect(view.notice).toBeUndefined();
    }
  });
  it('is shown only while the lobby is visible', () => {
    expect(auditWallVisible(snap([], { rooms: undefined }))).toBe(true); // preview keeps the fixture floor
    expect(auditWallVisible(snap([]))).toBe(false); // live, no rooms subscribed yet
    expect(auditWallVisible(snap([], { rooms: [{ id: 'payables', rowId: 'r' }] }))).toBe(false);
    expect(auditWallVisible(snap([], { rooms: [{ id: 'lobby', rowId: 'r' }] }))).toBe(true);
  });
});
