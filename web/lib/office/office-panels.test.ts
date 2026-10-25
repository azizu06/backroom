import { describe, expect, it } from 'vitest';
import { OFFICE_PANEL_TABS, officePanelCounts, officePanelTabForTarget } from './office-panels';
import { INITIAL_OFFICE } from './state';
import { createMockOfficeState } from './preview';

describe('office panel tabs', () => {
  it('gives each job one home, with receipts beside the inbox and Ask why beside audit', () => {
    expect(OFFICE_PANEL_TABS.map(({ id, content }) => [id, [...content]])).toEqual([
      ['summary', ['roster', 'today']], ['inbox', ['inbox', 'receipts']],
      ['audit', ['audit', 'ask-why']], ['activity', ['workday', 'handoffs']],
    ]);
  });

  it('counts received rows without conflating inbox, receipts, or handoffs', () => {
    expect(officePanelCounts(INITIAL_OFFICE)).toEqual({ summary: 0, inbox: 0, audit: 0, activity: 0 });
    const snapshot = createMockOfficeState().source.getSnapshot();
    const counts = officePanelCounts({ ...snapshot, inboxCount: 17 });
    expect(counts).toEqual({ summary: snapshot.agents.length, inbox: 17, audit: snapshot.audit.length, activity: snapshot.handoffs?.length ?? 0 });
  });

  it.each([
    ['#office-drawer', 'summary'], ['/inbox', 'inbox'], ['ticket-board', 'inbox'],
    ['#office-inbox-tray', 'inbox'], ['#office-preview-receipts', 'inbox'],
    ['/audit', 'audit'], ['#office-audit-wall', 'audit'], ['ask-why', 'audit'],
    ['workday', 'activity'], ['handoffs', 'activity'],
  ])('routes %s to %s', (target, tab) => expect(officePanelTabForTarget(target)).toBe(tab));

  it('ignores unknown destinations', () => {
    for (const target of [undefined, null, {}, '/controller', '#unknown']) expect(officePanelTabForTarget(target)).toBeUndefined();
  });
});
