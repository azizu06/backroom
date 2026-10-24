import { visibleRooms, type OfficeAudit, type OfficeSnapshot } from '../state';
import { truncateSummary } from './whiteboard';

/** Lobby west wall (face at x = -7.92), between the shelf (z 1.2..2.4) and the corner plant; faces +x. */
export const AUDIT_WALL = { x: -7.89, z: 3.0, bottom: 0.95, width: 2.4, height: 1.6, faceWidth: 2.26, faceHeight: 1.46 } as const;
export const AUDIT_WALL_MAX_ROWS = 6;
export const AUDIT_WALL_SUMMARY_MAX = 38;
export const RECEIPT_ID_MAX = 16;

export interface AuditWallRow {
  /** Audit entry id, shortened to fit one line; the same id the Play dialog and /audit show. */
  receipt: string;
  decision: OfficeAudit['decision'];
  summary: string;
}
export interface AuditWallView {
  rows: readonly AuditWallRow[];
  total: number;
  connection: OfficeSnapshot['connection'];
  /** Set when the feed is not the audit log, so no rows are painted (and nothing is presented as verified). */
  notice?: string;
}
/** Preview and replay snapshots are fixtures or derived copies, not `/api/audit/entries`; only the live feed carries real receipt ids. */
export const AUDIT_WALL_UNVERIFIED_FEEDS: readonly OfficeSnapshot['connection'][] = ['preview', 'replay'];
const AUDIT_WALL_NOTICES = {
  preview: 'Preview feed: no audit entries. Live receipts appear here; see /audit.',
  replay: 'Replay feed: no audit entries. Live receipts appear here; see /audit.',
} as const satisfies Record<'preview' | 'replay', string>;

/** Names the feed so a fixture or a replay is not presented as the audit log. */
export function auditWallNotice(connection: keyof typeof AUDIT_WALL_NOTICES): string {
  return AUDIT_WALL_NOTICES[connection];
}

/** Two canvas lines of an `auditWallNotice` string: the feed sentence, then where live receipts are. */
export function auditWallNoticeLines(notice: string): readonly [string, string] {
  const splitAt = notice.indexOf('. ');
  if (splitAt < 0) return [notice, ''];
  return [notice.slice(0, splitAt + 1), notice.slice(splitAt + 2)];
}

function unverifiedFeed(connection: OfficeSnapshot['connection']): connection is 'preview' | 'replay' {
  return (AUDIT_WALL_UNVERIFIED_FEEDS as readonly string[]).includes(connection);
}

/** Keeps both ends of a long id so neighbouring receipts stay distinguishable. */
export function shortReceipt(id: string, max = RECEIPT_ID_MAX): string {
  if (id.length <= max) return id;
  const tail = Math.floor((max - 1) / 3), head = max - 1 - tail;
  return `${id.slice(0, head)}…${id.slice(id.length - tail)}`;
}

/** Newest first, from the live snapshot's audit rows (the same ids as `/api/audit/entries`); nothing for preview or replay feeds. */
export function auditWallView(snapshot: OfficeSnapshot, max = AUDIT_WALL_MAX_ROWS): AuditWallView {
  const { connection } = snapshot;
  if (unverifiedFeed(connection)) {
    return { total: 0, connection, rows: [], notice: auditWallNotice(connection) };
  }
  return {
    total: snapshot.audit.length,
    connection,
    rows: snapshot.audit.slice(-max).reverse().map(row => ({
      receipt: shortReceipt(row.id), decision: row.decision, summary: truncateSummary(row.summary, AUDIT_WALL_SUMMARY_MAX),
    })),
  };
}

/** Plain-text mirror of the canvas, for assistive tech and tests. */
export function auditWallText(view: AuditWallView): string {
  return view.rows.map(row => `${row.receipt} ${row.decision} ${row.summary}`).join('\n');
}

export const auditWallVisible = (snapshot: OfficeSnapshot) => visibleRooms(snapshot).includes('lobby');
