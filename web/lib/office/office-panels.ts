import { visibleSeatAgents } from './agent-labels';
import type { OfficeSnapshot } from './state';

export const OFFICE_PANEL_TABS = [
  { id: 'summary', label: 'Summary', content: ['roster', 'today'] },
  { id: 'inbox', label: 'Inbox', content: ['inbox', 'receipts'] },
  { id: 'audit', label: 'Audit', content: ['audit', 'ask-why'] },
  { id: 'activity', label: 'Activity', content: ['workday', 'handoffs'] },
] as const;
export type OfficePanelTab = typeof OFFICE_PANEL_TABS[number]['id'];

/** Counts describe received rows, never a second fetch or a business decision. */
export function officePanelCounts(snapshot: OfficeSnapshot): Record<OfficePanelTab, number> {
  return {
    summary: visibleSeatAgents(snapshot).length,
    inbox: snapshot.inboxCount,
    audit: snapshot.audit.length,
    activity: snapshot.handoffs?.length ?? 0,
  };
}

/** Existing fragment links and the office-drawer event share the same destinations. */
export function officePanelTabForTarget(target: unknown): OfficePanelTab | undefined {
  switch (target) {
    case 'summary': case 'roster': case 'today': case '#office-drawer': return 'summary';
    case 'inbox': case 'receipts': case 'ticket-board': case '/inbox': case '#office-inbox-tray': case '#office-preview-receipts': return 'inbox';
    case 'audit': case 'ask-why': case '/audit': case '#office-audit-wall': return 'audit';
    case 'activity': case 'workday': case 'handoffs': return 'activity';
    default: return undefined;
  }
}
