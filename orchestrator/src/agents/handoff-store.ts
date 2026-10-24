import type { StateTransport } from '../spacetime-store';
import type { AuditInput, StateStore } from '../store';
import type { Activation, HandoffRecord, HandoffRequest, HandoffStore, Role, ToolContext } from './contracts';
import * as engine from './handoff-engine';
import type { ActivationRow, AgentHandoffPublic, CaseState, FinishOutcome, HandoffRow } from './handoff-engine';

export class HandoffRejectedError extends Error {
  constructor(readonly record: HandoffRecord & { errorCode?: string }) { super(record.errorCode ?? 'HANDOFF_REJECTED'); }
}
export interface StartedActivation { activation: ActivationRow; inbound?: HandoffRow }
/** The dispatcher's whole durable seam. Every method is one atomic transaction. */
export interface AgentCaseStore extends HandoffStore {
  openCase(input: { caseId: string; role: Role; artifactRefs: string[]; displayId?: string }): Promise<CaseState>;
  startActivation(caseId: string, leaseOwner: string): Promise<StartedActivation>;
  assertActive(activation: Activation): Promise<void>;
  recordArtifacts(ctx: ToolContext, refs: string[]): Promise<void>;
  /** Throws HandoffRejectedError after persisting the rejected row; ownership stays with the source. */
  commit(ctx: ToolContext, request: HandoffRequest): Promise<HandoffRecord>;
  finish(ctx: ToolContext, outcome: FinishOutcome, reason?: string): Promise<void>;
  stopCase(caseId: string, status: 'paused' | 'held' | 'failed' | 'cancelled', reason: string): Promise<void>;
  resumeCase(caseId: string): Promise<void>;
  getCase(caseId: string): Promise<CaseState | undefined>;
  listPublic(sinceSequence?: number): Promise<AgentHandoffPublic[]>;
}
const claim = (a: Activation) => ({ activationId: a.activationId, leaseOwner: a.leaseOwner, leaseToken: a.leaseToken });

/** Handoff lifecycle audits are public; inputs carry only the sanitized projection. */
export function handoffAudits(state: CaseState, before: readonly HandoffRow[], now: number): AuditInput[] {
  const prior = new Map(before.map(r => [r.handoffId, r.status]));
  return state.handoffs.filter(r => prior.get(r.handoffId) !== r.status).map(r => ({
    ts: now, actor: 'code', seat: 'controller', action: `agent_handoff_${r.status}`, ruleIds: r.errorCode ? [r.errorCode] : [],
    policyVersion: 0, refs: [state.caseId, r.handoffId], route: 'agent', inputs: { ...engine.toPublicHandoff(state, r) },
    latencyMs: 0, costUsd: 0 }));
}

/** Process-local reference store. Ops are synchronous on one object, so each is atomic. */
export class MemoryHandoffStore implements AgentCaseStore {
  private readonly cases = new Map<string, CaseState>();
  private sequence = 0;
  private readonly listeners = new Set<(row: AgentHandoffPublic) => void>();
  constructor(private readonly options: { audit?: StateStore; now?: () => number } = {}) {}
  /** Office/voice feed for the in-process demo; SpacetimeDB clients subscribe to the table instead. */
  subscribe(listener: (row: AgentHandoffPublic) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private now() { return (this.options.now ?? Date.now)(); }
  private async apply<T>(caseId: string, op: (state: CaseState) => T): Promise<T> {
    const current = this.cases.get(caseId);
    if (!current) throw new engine.AgentStateError('AGENT_CASE_NOT_FOUND');
    const draft = structuredClone(current);
    const result = op(draft);
    const audits = handoffAudits(draft, current.handoffs, this.now());
    this.cases.set(caseId, draft);
    if (audits.length) await this.options.audit?.appendAudits(audits);
    const changed = new Map(current.handoffs.map(r => [r.handoffId, r.status]));
    for (const r of draft.handoffs) if (changed.get(r.handoffId) !== r.status) for (const l of this.listeners) l(engine.toPublicHandoff(draft, r));
    return result;
  }
  async openCase(input: { caseId: string; role: Role; artifactRefs: string[]; displayId?: string }) {
    const state = engine.openCase(this.cases.get(input.caseId), { ...input, now: this.now() });
    this.cases.set(input.caseId, state);
    return structuredClone(state);
  }
  startActivation(caseId: string, leaseOwner: string) { return this.apply(caseId, s => engine.startActivation(s, { leaseOwner, now: this.now() })); }
  async assertActive(a: Activation) { await this.apply(a.caseId, s => { engine.assertActive(s, claim(a)); }); }
  recordArtifacts(ctx: ToolContext, refs: string[]) { return this.apply(ctx.activation.caseId, s => engine.recordArtifacts(s, claim(ctx.activation), refs)); }
  async commit(ctx: ToolContext, request: HandoffRequest): Promise<HandoffRecord> {
    const result = await this.apply(ctx.activation.caseId, s =>
      engine.commitHandoff(s, { ...claim(ctx.activation), request, now: this.now(), sequence: this.sequence + 1 }));
    if (!result.ok || !result.replayed) this.sequence = Math.max(this.sequence, result.record.sequence);
    if (!result.ok) throw new HandoffRejectedError(result.record);
    return result.record;
  }
  finish(ctx: ToolContext, outcome: FinishOutcome, reason?: string) {
    return this.apply(ctx.activation.caseId, s => engine.finishActivation(s, { ...claim(ctx.activation), outcome, reason, now: this.now() }));
  }
  stopCase(caseId: string, status: 'paused' | 'held' | 'failed' | 'cancelled', reason: string) {
    return this.apply(caseId, s => engine.stopCase(s, { status, reason, now: this.now() }));
  }
  resumeCase(caseId: string) { return this.apply(caseId, s => engine.resumeCase(s)); }
  async getCase(caseId: string) { const s = this.cases.get(caseId); return s && structuredClone(s); }
  async listPublic(sinceSequence = 0) {
    return [...this.cases.values()].flatMap(s => s.handoffs.map(r => engine.toPublicHandoff(s, r)))
      .filter(r => r.sequence > sinceSequence).sort((a, b) => a.sequence - b.sequence);
  }
}

/** Durable store over the additive `agent_*` reducers in spacetime/src/index.ts.
 * Reducers run the same engine with database time; the office reads `agent_handoff_public`. */
export class SpacetimeHandoffStore implements AgentCaseStore {
  constructor(private readonly transport: StateTransport) {}
  private async call<T>(method: string, values: unknown[]): Promise<T> {
    return await this.transport.invoke(method, values) as T;
  }
  openCase(input: { caseId: string; role: Role; artifactRefs: string[]; displayId?: string }) { return this.call<CaseState>('agentOpenCase', [input]); }
  startActivation(caseId: string, leaseOwner: string) { return this.call<StartedActivation>('agentStartActivation', [caseId, leaseOwner]); }
  async assertActive(a: Activation) { await this.call('agentAssertActive', [a.caseId, claim(a)]); }
  async recordArtifacts(ctx: ToolContext, refs: string[]) { await this.call('agentRecordArtifacts', [ctx.activation.caseId, claim(ctx.activation), refs]); }
  async commit(ctx: ToolContext, request: HandoffRequest): Promise<HandoffRecord> {
    const result = await this.call<engine.CommitResult>('agentCommitHandoff', [ctx.activation.caseId, claim(ctx.activation), request]);
    if (!result.ok) throw new HandoffRejectedError(result.record);
    return result.record;
  }
  async finish(ctx: ToolContext, outcome: FinishOutcome, reason?: string) {
    await this.call('agentFinishActivation', [ctx.activation.caseId, claim(ctx.activation), outcome, reason ?? null]);
  }
  async stopCase(caseId: string, status: 'paused' | 'held' | 'failed' | 'cancelled', reason: string) { await this.call('agentStopCase', [caseId, status, reason]); }
  async resumeCase(caseId: string) { await this.call('agentResumeCase', [caseId]); }
  async getCase(caseId: string) { return await this.call<CaseState | null>('agentGetCase', [caseId]) ?? undefined; }
  listPublic(sinceSequence = 0) { return this.call<AgentHandoffPublic[]>('agentListPublic', [sinceSequence]); }
}
