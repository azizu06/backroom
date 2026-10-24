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

/** Mounted on the Payables back wall; shown only while the payables room is visible. */
export const WHITEBOARD_INTERACTION: OfficePropInteraction = {
  id: 'whiteboard',
  prompt: 'Read whiteboard',
  position: [1.1, -4.95],
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
