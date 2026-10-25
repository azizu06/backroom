import { describe, expect, it } from 'vitest';
import { agentCards } from './agent-cards';
import { fullFloorSummary } from './full-floor';
import type { Handoff } from './handoffs';
import { INITIAL_OFFICE, type OfficeSnapshot } from './state';

describe('Full Floor summary', () => {
  it('counts the entire audit snapshot and only handoffs still in progress', () => {
    const handoffs: Handoff[] = ['offered', 'accepted', 'completed', 'rejected'].map((status, index) => ({
      handoffId: String(index), sequence: index, caseDisplayId: 'INV-1',
      fromAgentId: 'intake', toAgentId: 'collections', fromRole: 'intake', toRole: 'collections',
      fromVoiceRole: 'Intake', toVoiceRole: 'Collections', status: status as Handoff['status'],
      correction: false, reason: '', summary: '', line: '', createdAt: 0,
    }));
    const snapshot: OfficeSnapshot = { ...INITIAL_OFFICE, inboxCount: 7, handoffs, audit: [
      { id: 'a', agentId: 'collections', seatId: 'collections', action: 'review', decision: 'ALLOW', ruleIds: [], summary: 'Reviewed' },
      { id: 'b', agentId: 'collections', seatId: 'collections', action: 'review', decision: 'DENY', ruleIds: [], summary: 'Denied' },
    ] };
    expect(fullFloorSummary(snapshot, 0).counters).toEqual({ inbox: 7, handoffs: 2, audit: 2 });
    expect(fullFloorSummary(snapshot, 86_400_000).counters.audit).toBe(2);
    expect(fullFloorSummary(INITIAL_OFFICE, 0).counters).toEqual({ inbox: 0, handoffs: 0, audit: 0 });
  });

  it('uses the agent card status model and keeps current escalations and lost connection visible', () => {
    const snapshot: OfficeSnapshot = { ...INITIAL_OFFICE, connection: 'disconnected', agents: [
      { id: 'a', name: 'Alex', seatId: 'collections', targetAnchor: 'collections', pos: [0, 0], state: 'Idle', escalationId: 'e' },
      { id: 'b', name: 'Sam', seatId: 'payables', targetAnchor: 'payables', pos: [0, 0], state: 'Idle' },
    ] };
    const summary = fullFloorSummary(snapshot, 1000);
    expect(summary.roster).toEqual(agentCards(snapshot, 1000));
    expect(summary.roster.map(card => card.tag)).toEqual(['NEEDS YOU', 'READY']);
    expect(summary.warnings.map(warning => warning.id)).toEqual(['connection', 'a']);
    expect(fullFloorSummary({ ...snapshot, connection: 'live', agents: [] }, 1000).warnings).toEqual([]);
  });
});
