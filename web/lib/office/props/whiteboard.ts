import { BUILDING } from '../layout';
import { visibleRooms, type OfficeAudit, type OfficeSnapshot } from '../state';
import type { OfficePropInteraction } from './interact';

export const WHITEBOARD_SUMMARY_MAX = 34;
export interface WhiteboardRow { decision: OfficeAudit['decision']; summary: string }
export interface WhiteboardStats {
  allow: number; deny: number; escalate: number; recorded: number; total: number;
  inbox: number; agents: number; connection: OfficeSnapshot['connection'];
  /** Up to 3 newest audit rows, newest first. */
  recent: readonly WhiteboardRow[];
}

export function truncateSummary(text: string, max = WHITEBOARD_SUMMARY_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function whiteboardStats(snapshot: OfficeSnapshot): WhiteboardStats {
  const count = (decision: OfficeAudit['decision']) => snapshot.audit.filter(row => row.decision === decision).length;
  return {
    allow: count('ALLOW'), deny: count('DENY'), escalate: count('ESCALATE'), recorded: count('RECORDED'),
    total: snapshot.audit.length, inbox: snapshot.inboxCount, agents: snapshot.agents.length, connection: snapshot.connection,
    recent: snapshot.audit.slice(-3).reverse().map(row => ({ decision: row.decision, summary: truncateSummary(row.summary) })),
  };
}

/**
 * Board size in metres (frame, then the drawn face) and its height above the floor. Centred at
 * WHITEBOARD_INTERACTION.position[0], east of the reserved six-metre ticket-board bay.
 */
export const WHITEBOARD = { width: 2.4, height: 1.4, depth: 0.06, bottom: 1.15, faceWidth: 2.26, faceHeight: 1.26 } as const;

/** Mounted on the north perimeter; shown while the payables destination is visible. */
export const WHITEBOARD_INTERACTION: OfficePropInteraction = {
  id: 'whiteboard',
  prompt: 'Read whiteboard',
  position: [10.7, BUILDING.minZ + 0.8],
  radius: 1.6,
  visible: snapshot => visibleRooms(snapshot).includes('payables'),
  panel(snapshot) {
    const stats = whiteboardStats(snapshot);
    return {
      title: 'Payables board',
      rows: [
        { label: 'Allow', value: String(stats.allow) },
        { label: 'Deny', value: String(stats.deny) },
        { label: 'Hold', value: String(stats.escalate) },
        { label: 'Recorded', value: String(stats.recorded) },
        { label: 'Total', value: String(stats.total) },
        { label: 'Inbox', value: String(stats.inbox) },
        { label: 'Agents', value: String(stats.agents) },
        { label: 'Connection', value: stats.connection },
        ...stats.recent.map(row => ({ label: row.decision === 'ESCALATE' ? 'Hold' : row.decision, value: row.summary })),
      ],
    };
  },
};
