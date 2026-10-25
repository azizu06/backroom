import { describe, expect, it } from 'vitest';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type OfficeAudit, type OfficeSnapshot } from './state';
import { STORY_CHAPTERS } from './story';
import { recordedStoryDecision } from './story-evidence';

const live: OfficeSnapshot = {
  ...INITIAL_OFFICE, connection: 'live', llmEnabled: false,
  rooms: [{ id: 'treasury', rowId: 'treasury' }, { id: 'dana', rowId: 'dana' }, { id: 'vendor_onboarding', rowId: 'vendor_onboarding' }],
  agents: [{ id: 'alex', name: 'Alex', seatId: 'collections', targetAnchor: 'collections', pos: OFFICE_ANCHORS.collections.position, state: 'Idle' }],
};
const row = (changes: Partial<OfficeAudit> = {}): OfficeAudit => ({
  id: 'audit:1', agentId: 'alex', seatId: 'collections', action: 'request_room_entry',
  decision: 'DENY', room: 'treasury', ruleIds: ['NOT_IN_BADGE'], summary: 'Entry refused', ...changes,
});
const chapter = (id: string) => STORY_CHAPTERS.find(chapter => chapter.id === id)!;
const match = (id: string, changes: Partial<OfficeSnapshot> = {}) => recordedStoryDecision(chapter(id), { ...live, ...changes });
const notRecorded = { label: 'Not recorded in this session' };

describe('recorded story evidence', () => {
  it('reports not recorded for every chapter with live rooms and agents but no audit', () => {
    for (const chapter of STORY_CHAPTERS) expect(recordedStoryDecision(chapter, live)).toEqual(notRecorded);
  });

  it('links the latest Treasury entry denial using its exact rules and encoded audit id', () => {
    expect(match('treasury', { audit: [row(), row({ id: 'audit:2/#?', ruleIds: ['NOT_IN_BADGE', 'ROOM_LOCKED'] })] })).toEqual({
      label: 'Recorded: NOT_IN_BADGE, ROOM_LOCKED · audit audit:2/#?',
      href: '/audit?entry=audit%3A2%2F%23%3F#audit-replay',
    });
  });

  it('does not treat another room, action, or outcome as a Treasury entry denial', () => {
    for (const changes of [{ room: 'payables' as const }, { room: undefined }, { action: 'pay_invoice' }, { decision: 'ALLOW' as const }]) {
      expect(match('treasury', { audit: [row(changes)] })).toEqual(notRecorded);
    }
    expect(match('treasury', { denials: [{ room: 'treasury', agentId: 'alex', auditId: 'missing', at: 1 }] })).toEqual(notRecorded);
  });

  it('matches any BANK_CHANGE_HOLD receipt for the vendor chapter, regardless of decision', () => {
    for (const decision of ['ALLOW', 'DENY', 'ESCALATE', 'RECORDED'] as const) {
      expect(match('vendor', { audit: [row({ decision, ruleIds: ['BANK_CHANGE_HOLD'] })] })).toEqual({
        label: 'Recorded: BANK_CHANGE_HOLD · audit audit:1', href: '/audit?entry=audit%3A1#audit-replay',
      });
    }
    expect(match('vendor', { audit: [row({ ruleIds: ['BANK_CHANGE_HOLD_OTHER'] })] })).toEqual(notRecorded);
  });

  it('links an ESCALATE receipt for Dana without requiring a currently escalating agent', () => {
    expect(match('dana', { audit: [row({ decision: 'ESCALATE', ruleIds: ['MAX_INSTALLMENTS'] }), row()] })).toEqual({
      label: 'Recorded: MAX_INSTALLMENTS · audit audit:1', href: '/audit?entry=audit%3A1#audit-replay',
    });
    expect(match('dana', { audit: [row()] })).toEqual(notRecorded);
  });

  it('shows a received escalation folder without inventing rule ids or an audit link', () => {
    const agents = [{ ...live.agents[0]!, targetAnchor: 'dana' as const, escalationId: 'escalation:42' }];
    expect(match('dana', { agents })).toEqual({ label: 'Recorded: escalation escalation:42 · audit receipt unavailable' });
    expect(match('dana', { agents, audit: [row({ decision: 'ESCALATE', ruleIds: [] })] })).toEqual({
      label: 'Recorded: no rule ids · audit audit:1', href: '/audit?entry=audit%3A1#audit-replay',
    });
    expect(match('dana', { agents: [{ ...live.agents[0]!, targetAnchor: 'dana' }] })).toEqual(notRecorded);
    expect(match('vendor', { agents })).toEqual(notRecorded);
  });

  it('never uses unrelated receipts as evidence for the other scripted chapters', () => {
    const audit = [row(), row({ decision: 'ESCALATE', ruleIds: ['BANK_CHANGE_HOLD'] })];
    for (const id of ['inbox', 'sort', 'collections', 'handoff']) expect(match(id, { audit })).toEqual(notRecorded);
  });
});
