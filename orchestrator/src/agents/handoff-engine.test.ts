import { describe, expect, it } from 'vitest';
import * as engine from './handoff-engine';
import type { CaseState } from './handoff-engine';

const t = 1_000;
function started(role: Parameters<typeof engine.openCase>[1]['role'] = 'extractor', refs = ['doc:1']) {
  const state = engine.openCase(undefined, { caseId: 'case-1', role, artifactRefs: refs, now: t });
  const { activation } = engine.startActivation(state, { leaseOwner: 'runner', now: t + 1 });
  return { state, claim: { activationId: activation.activationId, leaseOwner: 'runner', leaseToken: activation.leaseToken! } };
}
const offer = (to: 'vendor' | 'payables' | 'intake' | 'auditor' | 'extractor', refs = ['doc:1']) =>
  ({ to, reason: 'done', summary: 'Extracted invoice 4419 for acct 123456789.', artifactRefs: refs });
let seq = 0;
const commit = (state: CaseState, claim: engine.LeaseClaim, request = offer('vendor')) =>
  engine.commitHandoff(state, { ...claim, request, now: t + 2, sequence: ++seq });

describe('handoff engine', () => {
  it('commits atomically: closes the source, queues exactly one target, then accepts on start', () => {
    const { state, claim } = started();
    const result = commit(state, claim);
    expect(result).toMatchObject({ ok: true, replayed: false, record: { status: 'offered', from: 'extractor', to: 'vendor', toActivationId: 'case-1:a2' } });
    expect(state.activations[0]!.status).toBe('handed_off');
    expect(state.activeActivationId).toBeUndefined();
    expect(state.queuedActivationId).toBe('case-1:a2');
    const next = engine.startActivation(state, { leaseOwner: 'runner', now: t + 3 });
    expect(next.activation).toMatchObject({ role: 'vendor', leaseToken: 2, artifactRefs: ['doc:1'] });
    expect(next.inbound).toMatchObject({ status: 'accepted', acceptedAt: t + 3 });
  });

  it('replays an identical retry and rejects a conflicting second offer from the same activation', () => {
    const { state, claim } = started();
    const first = commit(state, claim);
    expect(commit(state, claim)).toMatchObject({ ok: true, replayed: true, record: { handoffId: first.record.handoffId } });
    expect(() => commit(state, claim, offer('payables'))).toThrow('HANDOFF_CONFLICT');
    expect(state.activations).toHaveLength(2);
  });

  it('fences stale owners and tokens', () => {
    const { state, claim } = started();
    expect(() => commit(state, { ...claim, leaseToken: 99 })).toThrow('AGENT_LEASE_STALE');
    expect(() => commit(state, { ...claim, leaseOwner: 'intruder' })).toThrow('AGENT_LEASE_STALE');
    engine.stopCase(state, { status: 'cancelled', reason: 'CANCELLED', now: t + 5 });
    expect(() => commit(state, claim)).toThrow('AGENT_CASE_NOT_OPEN');
  });

  it('records a rejected row for a disallowed edge or unknown evidence and keeps ownership with the source', () => {
    const { state, claim } = started('intake');
    expect(commit(state, claim, offer('payables'))).toMatchObject({ ok: false, record: { status: 'rejected', errorCode: 'HANDOFF_EDGE_NOT_ALLOWED' } });
    expect(state.activeActivationId).toBe(claim.activationId);
    const other = started();
    expect(commit(other.state, other.claim, offer('vendor', ['doc:forged']))).toMatchObject({ ok: false, record: { errorCode: 'HANDOFF_UNKNOWN_REF' } });
    expect(commit(other.state, other.claim, offer('vendor', []))).toMatchObject({ ok: false });
  });

  it('accepts refs recorded from tool outputs and bounds correction returns', () => {
    let { state, claim } = started('vendor');
    engine.recordArtifacts(state, claim, ['vendor-evidence:case-1:verdict']);
    expect(commit(state, claim, offer('extractor', ['vendor-evidence:case-1:verdict']))).toMatchObject({ ok: true, record: { correction: true } });
    for (let round = 0; round < 1; round++) {
      claim = { ...claim, ...pick(engine.startActivation(state, { leaseOwner: 'runner', now: t })) };
      expect(commit(state, claim, offer('vendor', ['doc:1'])).ok).toBe(true);
      claim = { ...claim, ...pick(engine.startActivation(state, { leaseOwner: 'runner', now: t })) };
      expect(commit(state, claim, offer('extractor', ['doc:1'])).ok).toBe(true);
    }
    expect(state.corrections).toBe(2);
    claim = { ...claim, ...pick(engine.startActivation(state, { leaseOwner: 'runner', now: t })) };
    expect(commit(state, claim, offer('vendor', ['doc:1'])).ok).toBe(true);
    claim = { ...claim, ...pick(engine.startActivation(state, { leaseOwner: 'runner', now: t })) };
    expect(commit(state, claim, offer('extractor', ['doc:1']))).toMatchObject({ ok: false, record: { errorCode: 'HANDOFF_CORRECTION_LIMIT' } });
  });

  it('only lets terminal roles finish done; pause requeues the same role for resume', () => {
    const a = started('payables');
    expect(() => engine.finishActivation(a.state, { ...a.claim, outcome: 'done', now: t })).toThrow('AGENT_DONE_NOT_TERMINAL');
    engine.finishActivation(a.state, { ...a.claim, outcome: 'paused', reason: 'LLM_OFF', now: t });
    expect(a.state).toMatchObject({ status: 'paused', queuedActivationId: 'case-1:a2' });
    engine.resumeCase(a.state);
    expect(engine.startActivation(a.state, { leaseOwner: 'runner', now: t }).activation.role).toBe('payables');
    const b = started('auditor');
    engine.finishActivation(b.state, { ...b.claim, outcome: 'done', now: t });
    expect(b.state.status).toBe('done');
  });

  it('auditor may only return to a role that already worked the case', () => {
    const { state, claim } = started('auditor');
    expect(commit(state, claim, offer('payables'))).toMatchObject({ ok: false, record: { errorCode: 'HANDOFF_TARGET_NOT_IN_CASE' } });
  });

  it.each([
    ['New account 1234.5678.9012 routing 0210.0002.1', 'New account ••9012 routing ••0021'],
    ['Click https://acme-supp1y.com/pay?acct=99887766', 'Click [link]'],
    ['Click www.x.com or acme-supp1y.com/pay', 'Click [link] or [link]'],
    ...[' ', '-', '_', '/', '.', ' - '].map(separator =>
      [`Account ${['1234', '5678', '9012'].join(separator)}`, 'Account ••9012']),
    ['Email ap@evil.example SSN 123-45-6789 card 4111 1111 1111 1111 phone 212-555-1234 account 123456789',
      'Email [email] SSN ••6789 card ••1111 phone ••1234 account ••6789'],
    ['Visit HTTPS://example.com/pay and billing.acme-supp1y.com/pay?acct=99887766', 'Visit [link] and [link]'],
    ['Account 1234_5678/9012', 'Account ••9012'],
    ['Amounts 4950.00 and $1,234.56', 'Amounts 4950.00 and $1,234.56'],
  ])('public summary and spoken line sanitize %s', (summary, expected) => {
    const { state, claim } = started();
    const { record } = commit(state, claim, { ...offer('vendor'), summary });
    expect(engine.toPublicHandoff(state, record)).toMatchObject({ summary: expected, line: expected });
  });

  it('public projection is allowlisted, redacted and Cartesia-safe', () => {
    const { state, claim } = started();
    const { record } = commit(state, claim, { ...offer('vendor'), summary: 'Pay <script> ap@evil.example acct 123456789\nnow' });
    const row = engine.toPublicHandoff(state, record);
    expect(Object.keys(row).sort()).toEqual(['caseDisplayId', 'correction', 'createdAt', 'decisionRef', 'fromAgentId', 'fromRole', 'fromVoiceRole',
      'handoffId', 'line', 'reason', 'sequence', 'status', 'summary', 'toAgentId', 'toRole', 'toVoiceRole']);
    expect(row).toMatchObject({ fromRole: 'extractor', fromVoiceRole: 'extractor', toRole: 'vendor', toVoiceRole: 'vendor_verifier', toAgentId: 'vendor-agent' });
    expect(row.line).toBe(row.summary); // The author’s summary stays paired with fromVoiceRole.
    expect(row.line).not.toMatch(/[<>\x00-\x1f]|123456789|evil\.example/);
    expect(row.line).toContain('••6789');
    expect(Array.from(row.line).length).toBeLessThanOrEqual(240);
  });
});
const pick = (s: ReturnType<typeof engine.startActivation>) => ({ activationId: s.activation.activationId, leaseToken: s.activation.leaseToken! });

describe('live-call escalation to a human desk', () => {
  const input = { caseId: 'call:c1', displayId: '1042', from: 'collections' as const, escalationId: 'esc-1', toHuman: 'Dana',
    ruleIds: ['MAX_INSTALLMENTS'], artifactRefs: ['esc-1', 'ar_invoice:1042'] };

  it('publishes one held offer to Dana per escalation, idempotently, with a passkey reason the office can show', () => {
    const first = engine.escalateToHuman(undefined, { ...input, now: t, sequence: 7 });
    expect(first).toMatchObject({ created: true, state: { status: 'held', activations: [] }, record: { status: 'offered', toHuman: 'Dana' } });
    const again = engine.escalateToHuman(first.state, { ...input, now: t + 1, sequence: 8 });
    expect(again).toMatchObject({ created: false, record: { handoffId: first.record.handoffId, sequence: 7 } });
    expect(first.state.handoffs).toHaveLength(1);
    expect(engine.toPublicHandoff(first.state, first.record)).toMatchObject({ caseDisplayId: '1042', fromRole: 'collections',
      fromAgentId: 'collections-agent', toRole: 'human', toAgentId: 'human:Dana', fromVoiceRole: 'collections_caller',
      toVoiceRole: 'collections_caller', status: 'offered', decisionRef: 'esc-1', reason: expect.stringContaining('passkey') });
  });

  it('completes on approval, returns on denial or expiry, and never reopens a closed row', () => {
    const { state } = engine.escalateToHuman(undefined, { ...input, now: t, sequence: 1 });
    engine.escalateToHuman(state, { ...input, escalationId: 'esc-2', now: t, sequence: 2 });
    expect(engine.resolveHumanEscalation(state, { escalationId: 'esc-1', outcome: 'approved', now: t + 5 }))
      .toMatchObject({ status: 'completed', acceptedAt: t + 5, completedAt: t + 5 });
    expect(state.status).toBe('held');
    expect(engine.resolveHumanEscalation(state, { escalationId: 'esc-2', outcome: 'expired', now: t + 6 }))
      .toMatchObject({ status: 'rejected', errorCode: 'ESCALATION_EXPIRED' });
    expect(state.status).toBe('done');
    expect(engine.resolveHumanEscalation(state, { escalationId: 'esc-1', outcome: 'denied', now: t + 7 })).toMatchObject({ status: 'completed' });
    expect(engine.resolveHumanEscalation(state, { escalationId: 'unknown', outcome: 'denied', now: t + 7 })).toBeUndefined();
  });

  it('refuses agent cases, forged humans and model-shaped refs', () => {
    const { state: agentCase } = started('collections', ['ar_invoice:1042']);
    expect(() => engine.escalateToHuman(agentCase, { ...input, now: t, sequence: 1 })).toThrow('AGENT_CASE_EXISTS');
    expect(() => engine.escalateToHuman(undefined, { ...input, toHuman: 'dana<script>', now: t, sequence: 1 })).toThrow('INVALID_HUMAN_ESCALATION');
    expect(() => engine.escalateToHuman(undefined, { ...input, artifactRefs: ['has space'], now: t, sequence: 1 })).toThrow('INVALID_HUMAN_ESCALATION');
  });
});
