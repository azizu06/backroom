import { describe, expect, it } from 'vitest';
import { AGENT_DONE_MS, agentCardKey, agentCards } from './agent-cards';
import type { Handoff } from './handoffs';
import { INITIAL_OFFICE, type OfficeAgent, type OfficeAudit, type OfficeSnapshot } from './state';
import { agentTarget } from './targets/agent';

const agent: OfficeAgent = { id: 'a', name: 'Alex', seatId: 'collections', targetAnchor: 'collections', pos: [0, 0], state: 'Idle' };
const receipt: OfficeAudit = { id: 'receipt', agentId: 'a', seatId: 'collections', action: 'judge_inbox_decision', decision: 'ESCALATE', summary: 'Review this invoice', ruleIds: [] };
const handoff = (extra: Partial<Handoff> = {}): Handoff => ({
  handoffId: 'h1', sequence: 1n, caseDisplayId: 'INV-1042', fromAgentId: 'other', toAgentId: 'a',
  fromRole: 'intake', toRole: 'collections', fromVoiceRole: 'Intake', toVoiceRole: 'Collections',
  status: 'accepted', correction: false, reason: 'Review', summary: 'Check the invoice', line: '', createdAt: 100, ...extra,
});
const snapshot = (extra: Partial<OfficeSnapshot> = {}): OfficeSnapshot => ({ ...INITIAL_OFFICE, agents: [agent], ...extra });
const card = (extra: Partial<OfficeSnapshot> = {}, now = 1000) => agentCards(snapshot(extra), now)[0]!;

describe('agent cards', () => {
  it('returns one ready card per agent, in roster order, without inventing work from state text', () => {
    const cards = agentCards(snapshot({ agents: [agent, { ...agent, id: 'b', name: 'Sam', state: 'Reviewing' }] }), 1000);
    expect(cards.map(row => row.agentId)).toEqual(['a', 'b']);
    expect(cards[0]).toMatchObject({ title: 'Alex · Collections', line: 'Ask me about issues/PRs', tag: 'READY', colourRole: 'statusOk', agentColour: 'mint' });
    expect(cards[1]!.tag).toBe('READY');
  });

  it('shows the accepted recipient ticket and summary as Working, not the sender', () => {
    expect(card({ handoffs: [handoff()] })).toMatchObject({ title: 'Alex · Collections · INV-1042', line: 'Check the invoice', tag: 'WORKING', colourRole: 'screenGlow' });
    expect(card({ handoffs: [handoff({ fromAgentId: 'a', toAgentId: 'other' })] }).tag).toBe('READY');
    for (const status of ['offered', 'rejected'] as const) expect(card({ handoffs: [handoff({ status })] }).tag).toBe('READY');
  });

  it('prioritizes escalationId over accepted work and recent completion', () => {
    expect(card({ agents: [{ ...agent, escalationId: 'e' }], handoffs: [handoff()] })).toMatchObject({ tag: 'NEEDS YOU', colourRole: 'statusWarn' });
    expect(card({ agents: [{ ...agent, escalationId: 'e' }], handoffs: [handoff({ status: 'completed', completedAt: 1000 })] }).tag).toBe('NEEDS YOU');
  });

  it('shows explicit escalated inbox receipts, but not unrelated or ordinary recorded receipts', () => {
    expect(card({ inboxReceipts: [receipt] })).toMatchObject({ tag: 'NEEDS YOU', line: 'Review this invoice' });
    expect(card({ inboxReceipts: [{ ...receipt, agentId: 'other' }] }).tag).toBe('READY');
    expect(card({ inboxReceipts: [{ ...receipt, decision: 'RECORDED' }] }).tag).toBe('READY');
  });

  it('uses the latest audit decision for this agent rather than a historical escalation', () => {
    expect(card({ audit: [receipt, { ...receipt, agentId: 'other', decision: 'ALLOW' }] }).tag).toBe('NEEDS YOU');
    expect(card({ audit: [receipt, { ...receipt, id: 'resolved', decision: 'ALLOW' }] }).tag).toBe('READY');
  });

  it.each(['ALLOW', 'DENY', 'RECORDED'] as const)('a later %s resolves audit and inbox escalations for the same agent', decision => {
    const resolved = { ...receipt, id: 'resolved', action: 'later_decision', decision };
    expect(card({ audit: [receipt, resolved] }).tag).toBe('READY');
    expect(card({ inboxReceipts: [receipt, resolved] }).tag).toBe('READY');
    // The inbox subset still ends at ESCALATE after a non-inbox audit decision.
    expect(card({ audit: [receipt, resolved], inboxReceipts: [receipt] }).tag).toBe('READY');
    expect(card({ audit: [resolved, receipt], inboxReceipts: [receipt] }).tag).toBe('NEEDS YOU');
    expect(card({ inboxReceipts: [resolved, receipt] }).tag).toBe('NEEDS YOU');
    expect(card({ audit: [receipt, { ...resolved, agentId: 'other' }], inboxReceipts: [receipt] }).tag).toBe('NEEDS YOU');
    expect(card({ inboxReceipts: [receipt, { ...resolved, agentId: 'other' }] }).tag).toBe('NEEDS YOU');
  });

  it.each(['offered', 'accepted'] as const)('marks an incoming %s handoff needing human approval as Needs you', status => {
    expect(card({ handoffs: [handoff({ status, reason: 'Requires human approval' })] }).tag).toBe('NEEDS YOU');
    expect(card({ handoffs: [handoff({ status, decisionRef: 'passkey required' })] }).tag).toBe('NEEDS YOU');
    expect(card({ handoffs: [handoff({ status, reason: 'No human approval required' })] }).tag).not.toBe('NEEDS YOU');
    expect(card({ handoffs: [handoff({ status, fromAgentId: 'a', toAgentId: 'other', reason: 'Requires human approval' })] }).tag).toBe('READY');
  });

  it.each(['completed', 'rejected'] as const)('does not treat a %s handoff as awaiting the human', status => {
    expect(card({ handoffs: [handoff({ status, reason: 'Requires human approval' })] }).tag).toBe('READY');
  });

  it('keeps the talk prompt suffix in sync with every Needs-you source and resolution', () => {
    const states: Partial<OfficeSnapshot>[] = [
      {}, { agents: [{ ...agent, escalationId: 'e' }] }, { audit: [receipt] }, { inboxReceipts: [receipt] },
      { handoffs: [handoff({ reason: 'Requires human approval' })] },
      { audit: [receipt, { ...receipt, id: 'resolved', decision: 'RECORDED' }], inboxReceipts: [receipt] },
    ];
    for (const extra of states) {
      const suffix = card(extra).tag === 'NEEDS YOU' ? ' (needs you)' : '';
      expect(agentTarget.label(snapshot(extra), { kind: 'agent', id: 'a' })).toBe(`Talk to Alex${suffix}`);
    }
    expect(agentTarget.label(snapshot(), { kind: 'agent', id: 'missing' })).toBe('Talk to missing');
  });

  it('shows Done for exactly 20 seconds, then restores the idle invitation', () => {
    const state = { handoffs: [handoff({ status: 'completed', completedAt: 1000 })] };
    expect(card(state, 1000)).toMatchObject({ tag: 'DONE', colourRole: 'statusOk', line: 'Check the invoice' });
    expect(card(state, 1000 + AGENT_DONE_MS - 1).tag).toBe('DONE');
    expect(card(state, 1000 + AGENT_DONE_MS)).toMatchObject({ tag: 'READY', line: 'Ask me about issues/PRs' });
    expect(card(state, 999).tag).toBe('READY');
    expect(card({ handoffs: [handoff({ status: 'completed' })] }).tag).toBe('READY');
  });

  it('prefers active work to Done and does not revive an older completion after a newer handoff', () => {
    const done = handoff({ status: 'completed', completedAt: 1000 });
    const next = handoff({ handoffId: 'h2', sequence: 2n, caseDisplayId: 'INV-2000' });
    expect(card({ handoffs: [next, done] })).toMatchObject({ tag: 'WORKING', title: 'Alex · Collections · INV-2000' });
    expect(card({ handoffs: [done, { ...next, status: 'rejected' }] }).tag).toBe('READY');
  });

  it('is deterministic without mutating input, and keys only painted content', () => {
    const rows = Object.freeze([Object.freeze(handoff({ status: 'completed', completedAt: 1000 }))]);
    const input = Object.freeze(snapshot({ handoffs: rows }));
    expect(agentCards(input, 1000)).toEqual(agentCards(input, 1000));
    expect(agentCardKey(agentCards(input, 1000)[0]!)).toBe(agentCardKey(agentCards(input, 2000)[0]!));
    expect(agentCardKey(card({ agents: [{ ...agent, rowAt: 99, pos: [8, 8] }] }))).toBe(agentCardKey(card()));
    expect(agentCardKey(agentCards(input, 1000)[0]!)).not.toBe(agentCardKey(agentCards(input, 21_000)[0]!));
  });
});
