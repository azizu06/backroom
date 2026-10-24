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

  it('public projection is allowlisted, redacted and Cartesia-safe', () => {
    const { state, claim } = started();
    const { record } = commit(state, claim, { ...offer('vendor'), summary: 'Pay <script> ap@evil.example acct 123456789\nnow' });
    const row = engine.toPublicHandoff(state, record);
    expect(Object.keys(row).sort()).toEqual(['caseDisplayId', 'correction', 'createdAt', 'decisionRef', 'fromAgentId', 'fromRole', 'fromVoiceRole',
      'handoffId', 'line', 'reason', 'sequence', 'status', 'summary', 'toAgentId', 'toRole', 'toVoiceRole']);
    expect(row).toMatchObject({ fromRole: 'extractor', toRole: 'vendor', toVoiceRole: 'vendor_verifier', toAgentId: 'vendor-agent' });
    expect(row.line).not.toMatch(/[<>\x00-\x1f]|123456789|evil\.example/);
    expect(row.line).toContain('••6789');
    expect(Array.from(row.line).length).toBeLessThanOrEqual(240);
  });
});
const pick = (s: ReturnType<typeof engine.startActivation>) => ({ activationId: s.activation.activationId, leaseToken: s.activation.leaseToken! });
