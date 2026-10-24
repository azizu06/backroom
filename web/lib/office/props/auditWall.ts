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
  /** Set when the snapshot is not the live audit log; the wall then paints this instead of rows. */
  notice?: string;
  rows: readonly AuditWallRow[];
  total: number;
  connection: OfficeSnapshot['connection'];
}

/** Keeps both ends of a long id so neighbouring receipts stay distinguishable. */
export function shortReceipt(id: string, max = RECEIPT_ID_MAX): string {
  if (id.length <= max) return id;
  const tail = Math.floor((max - 1) / 3), head = max - 1 - tail;
  return `${id.slice(0, head)}…${id.slice(id.length - tail)}`;
}

const NOTICES: Record<Exclude<OfficeSnapshot['connection'], 'live'>, string> = {
  preview: 'Preview · simulated state, not the audit log',
  replay: 'Replay · not the live audit log',
  connecting: 'Connecting to the audit log…',
  disconnected: 'Audit log disconnected',
};

/**
 * Newest first. Only the live feed paints rows (its ids are the /api/audit/entries ids); preview, replay and
 * offline snapshots are not that log, so they get a notice instead of rows that look like receipts.
 */
export function auditWallView(snapshot: OfficeSnapshot, max = AUDIT_WALL_MAX_ROWS): AuditWallView {
  const live = snapshot.connection === 'live';
  return {
    ...(live ? {} : { notice: NOTICES[snapshot.connection] }),
    total: live ? snapshot.audit.length : 0,
    connection: snapshot.connection,
    rows: !live ? [] : snapshot.audit.slice(-max).reverse().map(row => ({
      receipt: shortReceipt(row.id), decision: row.decision, summary: truncateSummary(row.summary, AUDIT_WALL_SUMMARY_MAX),
    })),
  };
}

/** Plain-text mirror of the canvas, for assistive tech and tests. */
export function auditWallText(view: AuditWallView): string {
  if (view.notice) return view.notice;
  return view.rows.map(row => `${row.receipt} ${row.decision} ${row.summary}`).join('\n');
}

export const auditWallVisible = (snapshot: OfficeSnapshot) => visibleRooms(snapshot).includes('lobby');
