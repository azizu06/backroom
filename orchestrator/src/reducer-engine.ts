import type { ControllerDecision } from './approvals/types';
import { approvalWindowMs } from './approvals/window';
export type ApprovalGrant = { id: string; human: string; decision: ControllerDecision; credentialId: string };
import { AuditLog, cloneState } from './audit';
import { DEFAULT_POLICY, savePolicy, type Decision, type Policy } from '@backroom/policy';
import type { Agent, AgentState, AuditEntry, AuditInput, Escalation, Invoice, InvoiceState,
  CallEscalation, Lease, NewTask, PaymentReceipt, Seat, Task, PolicyLimits, PolicySaveMethod } from './store';

const copy = <T>(value: T): T => cloneState(value);
export { hashAudit } from './audit';

/** Single-process reducer analogue: no awaits inside read/check/write sections. */
export class ReducerEngine {
  readonly policies = new Map<number, Policy>([[1, copy(DEFAULT_POLICY)]]);
  currentPolicyVersion = 1;
  getPolicy(version = this.currentPolicyVersion): Policy {
    const policy = this.policies.get(version);
    if (!policy) throw new Error('POLICY_NOT_FOUND');
    return copy(policy);
  }
  savePolicyLimits(expectedVersion: number, limits: PolicyLimits, now: number, method: PolicySaveMethod = 'demo_pin'): Policy {
    if (expectedVersion !== this.currentPolicyVersion) throw new Error('POLICY_CONFLICT');
    if (!limits || Object.keys(limits).sort().join(',') !== 'maxInstallments,maxPaymentCents,maxPlanDays,minFirstPct'
      || !Number.isSafeInteger(limits.maxInstallments) || limits.maxInstallments < 1
      || !Number.isFinite(limits.minFirstPct) || limits.minFirstPct < 0 || limits.minFirstPct > 100
      || !Number.isSafeInteger(limits.maxPlanDays) || limits.maxPlanDays < 0
      || !Number.isSafeInteger(limits.maxPaymentCents) || limits.maxPaymentCents < 1) throw new Error('INVALID_LIMITS');
    const previous = this.policies.get(this.currentPolicyVersion)!;
    const draft = copy(previous);
    Object.assign(draft.badges.collections.limits, { maxInstallments: limits.maxInstallments,
      minFirstPct: limits.minFirstPct, maxPlanDays: limits.maxPlanDays });
    draft.badges.payables.maxPaymentCents = limits.maxPaymentCents;
    const next = savePolicy(previous, draft);
    // No await in this check/write section; audit failure leaves policy unchanged.
    this.append({ ts: now, actor: 'human', seat: 'controller', action: 'save_policy', ruleIds: ['POLICY_SAVED'],
      policyVersion: next.policyVersion, refs: [`policy:v${previous.policyVersion}`, `policy:v${next.policyVersion}`],
      route: 'code', latencyMs: 0, costUsd: 0, inputs: { previousVersion: previous.policyVersion, limits: copy(limits), method: method === 'operator_session' ? method : 'demo_pin' } });
    this.policies.set(next.policyVersion, next);
    this.currentPolicyVersion = next.policyVersion;
    return copy(next);
  }

  modelsEnabled = true;
  get llmEnabled() { return this.modelsEnabled; }
  setLlmEnabled(enabled: boolean, now: number) {
    if (typeof enabled !== 'boolean') throw new Error('INVALID_LLM_ENABLED');
    if (enabled === this.modelsEnabled) return;
    this.modelsEnabled = enabled;
    this.append({ ts: now, actor: 'code', seat: 'controller', action: 'set_llm_enabled',
      ruleIds: ['LLM_SWITCH'], policyVersion: 0, refs: ['runtime_control:global'], route: 'code',
      inputs: { llmEnabled: enabled }, latencyMs: 0, costUsd: 0 });
  }
  readonly agents = new Map<string, Agent>();
  readonly tasks = new Map<string, Task>();
  readonly escalations = new Map<string, Escalation>();
  audit = new AuditLog();
  readonly payments = new Map<string, PaymentReceipt>();
  readonly paymentFingerprints = new Map<string, string>();
  readonly invoices = new Map<string, Invoice>();

  registerAgent(id: string, seatId: Seat, now: number): void {
    if (this.agents.has(id)) throw new Error('AGENT_EXISTS');
    this.agents.set(id, { id, seatId, state: 'idle', room: seatId,
      pos: { x: 0, y: 0, z: 0 }, heartbeatAt: now, modelRoute: 'code' });
  }
  getAgent(id: string) { return copy(this.agents.get(id)); }
  getTask(id: string) { return copy(this.tasks.get(id)); }
  heartbeat(id: string, now: number) {
    this.reap(now);
    const agent = this.agent(id);
    agent.heartbeatAt = now;
    if (agent.state === 'offline') agent.state = 'idle';
  }
  enqueueTask(input: NewTask) {
    if (this.tasks.has(input.id)) throw new Error('TASK_EXISTS');
    if (input.steps.filter(step => step.kind === 'nessie').length > 1) throw new Error('ONE_PAYMENT_PER_TASK');
    if (input.steps.some(step => step.kind === 'nessie') && !input.idempotencyKey) throw new Error('PAYMENT_KEY_REQUIRED');
    this.tasks.set(input.id, { ...copy(input), kind: input.steps[0]?.kind ?? 'noop',
      status: 'queued', leaseToken: 0, cursor: 0 });
  }
  claimTask(agentId: string, now: number, leaseMs: number): Lease | undefined {
    this.reap(now);
    const agent = this.agent(agentId);
    if (agent.state === 'offline' || now - agent.heartbeatAt > 15000) return;
    if ([...this.tasks.values()].some(t => t.seatId === agent.seatId && t.status === 'in_progress')) return;
    const task = [...this.tasks.values()].find(t => t.seatId === agent.seatId && (t.status === 'queued' || (t.status === 'paused' && this.llmEnabled)));
    if (!task) return;
    task.status = 'in_progress'; task.leaseOwner = agentId;
    task.leaseExpiresAt = now + leaseMs; task.leaseToken++;
    agent.state = 'working'; agent.currentTaskId = task.id;
    return copy(task as Lease);
  }
  assertLease(lease: Lease, now: number) { this.owned(lease, now); }
  renewLease(lease: Lease, now: number, leaseMs: number) {
    this.owned(lease, now).leaseExpiresAt = now + leaseMs;
  }
  reapExpired(now: number) { this.reap(now); }
  private reap(now: number) {
    this.expire(now);
    for (const agent of this.agents.values()) {
      if (now - agent.heartbeatAt > 15000) agent.state = 'offline';
    }
    for (const task of this.tasks.values()) {
      if (task.status !== 'in_progress') continue;
      const owner = this.agent(task.leaseOwner!);
      if (task.leaseExpiresAt! <= now || owner.state === 'offline') {
        this.append({ ts: now, actor: this.llmEnabled ? 'system' : 'code', seat: task.seatId, action: 'lease_expired',
          ruleIds: ['LEASE_EXPIRED'], policyVersion: task.steps[task.cursor]?.context.policyVersion ?? 0,
          refs: [...task.refs, task.id], route: 'code', latencyMs: 0, costUsd: 0 });
        task.status = 'queued'; task.leaseOwner = undefined; task.leaseExpiresAt = undefined;
        owner.currentTaskId = undefined; owner.targetAnchor = undefined;
        if (owner.state !== 'offline') owner.state = 'idle';
      }
    }
  }
  setAgentState(lease: Lease, state: AgentState, now: number) {
    const task = this.owned(lease, now);
    const agent = this.agent(lease.leaseOwner);
    if (!agentTransitions[agent.state].includes(state) || (state === 'waiting' && !task.escalationId)) {
      throw new Error('INVALID_AGENT_TRANSITION');
    }
    agent.state = state;
  }
  setAgentTarget(lease: Lease, targetAnchor: string, now: number) {
    this.owned(lease, now);
    const agent = this.agent(lease.leaseOwner);
    if (!agentTransitions[agent.state].includes('walking')) throw new Error('INVALID_AGENT_TRANSITION');
    agent.state = 'walking'; agent.targetAnchor = targetAnchor;
  }
  pauseTask(lease: Lease, now: number) {
    const task = this.owned(lease, now);
    task.status = 'paused'; task.leaseOwner = undefined; task.leaseExpiresAt = undefined;
    const agent = this.agent(lease.leaseOwner);
    agent.state = 'paused'; agent.currentTaskId = undefined; agent.targetAnchor = undefined;
  }
  advanceTask(lease: Lease, now: number) { this.owned(lease, now).cursor++; }
  completeTask(lease: Lease, status: 'done' | 'denied' | 'failed', now: number) {
    const task = this.owned(lease, now);
    task.status = status; task.leaseOwner = undefined; task.leaseExpiresAt = undefined;
    const agent = this.agent(lease.leaseOwner);
    agent.state = 'idle'; agent.currentTaskId = undefined; agent.targetAnchor = undefined;
  }
  createEscalation(lease: Lease, decision: Extract<Decision, { kind: 'ESCALATE' }>, now: number) {
    const task = this.owned(lease, now);
    if (task.escalationId) return copy(this.escalations.get(task.escalationId)!);
    const escalation: Escalation = { id: `escalation:${task.id}`, taskId: task.id,
      fromAgent: lease.leaseOwner, toHuman: decision.toHuman, ruleIds: [...decision.ruleIds],
      evidenceRefs: [...task.refs], status: 'pending', createdAt: now, expiresAt: now + 60_000,
      policyVersion: decision.policyVersion, quote: copy(decision.quote) };
    const step = task.steps[task.cursor];
    if (step?.action.type === 'propose_plan') {
      const plan = step.action.plan;
      escalation.requestedTerms = { installments: plan.installments, firstPaymentPct: plan.firstPaymentPct,
        durationDays: plan.totalDays, waiveFee: plan.waiveFees, discountPct: plan.discountPct };
      escalation.principalCents = step.context.receivable?.principalCents;
      escalation.lateFeeCents = step.context.receivable?.lateFeeCents;
      if (step.context.receivable) escalation.amountCents = step.context.receivable.principalCents + step.context.receivable.lateFeeCents;
    }
    this.escalations.set(escalation.id, escalation); task.escalationId = escalation.id;
    const agent = this.agent(lease.leaseOwner);
    agent.state = 'walking'; agent.targetAnchor = `${decision.toHuman}_desk`;
    return copy(escalation);
  }
  /** Trusted gateway ingress; ids, evidence and money come from its persisted call, never speech. */
  createCallEscalation(input: CallEscalation, now: number): Escalation {
    const existing = this.escalations.get(input.id);
    if (existing) return copy(existing);
    const { seat, ...fields } = copy(input);
    let agent = this.agents.get(input.fromAgent);
    if (!agent) {
      agent = { id: input.fromAgent, seatId: seat, state: 'on_call', room: seat,
        pos: { x: 0, y: 0, z: 0 }, heartbeatAt: now, modelRoute: 'code' };
      this.agents.set(agent.id, agent);
    }
    // A live call stays open for the call, up to APPROVAL_WINDOW_MS. Rows with no callId keep the 60s worker window.
    const liveCall = typeof input.callId === 'string' && input.callId.length > 0;
    const escalation: Escalation = { ...fields, createdAt: now, expiresAt: now + (liveCall ? approvalWindowMs() : 60_000), status: 'pending' };
    this.escalations.set(escalation.id, escalation);
    agent.state = 'walking'; agent.targetAnchor = `${input.toHuman}_desk`;
    this.append({ ts: now, actor: 'code', seat, action: 'create_escalation', ruleIds: input.ruleIds,
      policyVersion: input.policyVersion, refs: [input.id, ...input.evidenceRefs], route: 'code',
      decision: 'ESCALATE', latencyMs: 0, costUsd: 0 });
    return copy(escalation);
  }
  decideEscalation(verified: ApprovalGrant, now: number): Escalation {
    this.expire(now);
    const escalation = this.escalations.get(verified.id);
    if (!escalation || escalation.toHuman !== verified.human) throw new Error('ESCALATION_NOT_FOUND');
    if (escalation.status !== 'pending') throw new Error('ESCALATION_CLOSED');
    escalation.status = verified.decision.kind === 'Approve' ? 'approved' : verified.decision.kind === 'Deny' ? 'denied' : 'counter';
    escalation.decision = copy(verified.decision); escalation.decidedAt = now;
    escalation.method = 'passkey'; escalation.credentialId = verified.credentialId;
    this.append({ ts: now, actor: 'human', seat: 'controller',
      action: 'decide_escalation', ruleIds: escalation.ruleIds, policyVersion: escalation.policyVersion,
      refs: [escalation.id, ...escalation.evidenceRefs], route: 'passkey',
      inputs: { decision: verified.decision, method: 'passkey' }, latencyMs: 0, costUsd: 0 });
    return copy(escalation);
  }
  expireEscalations(now: number, callId?: string) {
    if (callId !== undefined && (typeof callId !== 'string' || callId.length === 0 || callId.length > 200)) throw new Error('INVALID_CALL');
    this.expire(now, callId);
  }
  private expire(now: number, endedCallId?: string) {
    for (const escalation of this.escalations.values()) {
      const liveCall = typeof escalation.callId === 'string' && escalation.callId.length > 0;
      const ended = liveCall && endedCallId !== undefined && escalation.callId === endedCallId;
      const pending = escalation.status === 'pending';
      // A window timeout leaves the row expired and the invoice alone. Call end still records follow-up once.
      const followUp = ended && escalation.status === 'expired';
      if ((!pending && !followUp) || (pending && !ended && now < escalation.expiresAt)) continue;
      const seat = this.agents.get(escalation.fromAgent)?.seatId ?? 'collections';
      const audit = (action: string) => this.append({ ts: now, actor: 'system', seat, action, ruleIds: escalation.ruleIds,
        policyVersion: escalation.policyVersion, refs: [escalation.id, ...escalation.evidenceRefs], route: 'code', latencyMs: 0, costUsd: 0 });
      if (liveCall && pending) {
        escalation.status = 'expired';
        audit('escalation_expired');
        if (!ended) continue;
      } else if (!liveCall) escalation.status = 'pending_owner';
      if (this.audit.list().some(entry => entry.action === 'pending_owner' && entry.refs[0] === escalation.id)) continue;
      const invoice = escalation.invoiceId && this.invoices.get(escalation.invoiceId);
      if (invoice && invoice.kind === 'ar' && ['in_collection', 'escalated'].includes(invoice.state)) invoice.state = 'pending_owner';
      audit('pending_owner');
    }
  }
  getEscalation(id: string) { return copy(this.escalations.get(id)); }
  appendAudit(input: AuditInput) {
    return this.append(input);
  }
  private append(input: AuditInput) {
    return this.audit.append(input);
  }
  appendAudits(inputs: readonly AuditInput[]) { return this.audit.appendMany(inputs); }
  listAudit(sinceSeq = 0) { return this.audit.list(sinceSeq); }
  getAudit(id: string) { return this.audit.get(id); }
  verifyAuditChain() { return this.audit.verifyChain(); }
  getPayment(key: string) { return copy(this.payments.get(key)); }
  reservePayment(lease: Lease, key: string, fingerprint: string, now: number) {
    const task = this.owned(lease, now);
    if (!key || task.idempotencyKey !== key) throw new Error('PAYMENT_KEY_REQUIRED');
    const prior = this.paymentFingerprints.get(key);
    if (prior !== undefined && prior !== fingerprint) throw new Error('PAYMENT_KEY_CONFLICT');
    this.paymentFingerprints.set(key, fingerprint);
    return copy(this.payments.get(key));
  }
  recordPayment(lease: Lease, receipt: PaymentReceipt, now: number) {
    const task = this.owned(lease, now);
    if (task.idempotencyKey !== receipt.key || this.paymentFingerprints.get(receipt.key) !== receipt.fingerprint) {
      throw new Error('PAYMENT_KEY_CONFLICT');
    }
    const existing = this.payments.get(receipt.key);
    if (existing && existing.fingerprint !== receipt.fingerprint) throw new Error('PAYMENT_KEY_CONFLICT');
    this.payments.set(receipt.key, copy(existing ?? receipt));
  }
  insertInvoice(invoice: Invoice) {
    if (this.invoices.has(invoice.id)) throw new Error('INVOICE_EXISTS');
    this.invoices.set(invoice.id, copy(invoice));
  }
  transitionInvoice(lease: Lease, id: string, from: InvoiceState, to: InvoiceState, now: number) {
    this.owned(lease, now);
    const invoice = this.invoices.get(id);
    if (!invoice || invoice.state !== from || !transitions[invoice.kind][from]?.includes(to)) {
      throw new Error('INVALID_INVOICE_TRANSITION');
    }
    invoice.state = to;
  }
  /** Adapter transaction entry point. Business transitions and their evidence
   * commit together in reducers; heartbeat/renewal timestamps do not flood the wall. */
  execute<K extends Exclude<keyof ReducerEngine, 'execute'>>(method: K,
    args: Parameters<Extract<ReducerEngine[K], (...values: never[]) => unknown>>, at = Date.now()):
    ReturnType<Extract<ReducerEngine[K], (...values: never[]) => unknown>> {
    const fn = this[method] as (...values: unknown[]) => unknown;
    const result = fn.apply(this, args);
    if (auditedMutations.has(method) && (method !== 'claimTask' || result)) {
      const first = args[0] as { id?: string; seatId?: Seat } | string | undefined;
      const id = typeof first === 'string' ? first : first?.id;
      const task = id ? this.tasks.get(id) : undefined;
      const agent = id ? this.agents.get(id) : undefined;
      const seat = task?.seatId ?? agent?.seatId ?? (typeof first === 'object' ? first?.seatId : undefined) ?? 'controller';
      this.append({ ts: at, actor: 'code', seat, action: `state.${String(method)}`, ruleIds: [], policyVersion: 0,
        refs: id ? [id] : [], route: 'code', inputs: { id, taskId: task?.id, leaseToken: task?.leaseToken, cursor: task?.cursor }, latencyMs: 0, costUsd: 0 });
    }
    return result as ReturnType<Extract<ReducerEngine[K], (...values: never[]) => unknown>>;
  }
  private agent(id: string): Agent {
    const agent = this.agents.get(id); if (!agent) throw new Error('AGENT_NOT_FOUND'); return agent;
  }
  private owned(lease: Lease, now: number): Task {
    const task = this.tasks.get(lease.id);
    const agent = this.agents.get(lease.leaseOwner);
    if (!task || task.status !== 'in_progress' || task.leaseOwner !== lease.leaseOwner ||
      task.leaseToken !== lease.leaseToken || task.leaseExpiresAt! <= now ||
      !agent || agent.state === 'offline' || now - agent.heartbeatAt > 15000) throw new Error('LEASE_LOST');
    return task;
  }
}

const agentTransitions: Record<AgentState, AgentState[]> = {
  idle: ['working'], working: ['working', 'walking', 'on_call'], walking: ['walking', 'waiting', 'working'],
  waiting: ['waiting', 'walking', 'on_call'], on_call: ['working', 'walking', 'on_call'], paused: ['working'], offline: [],
};

const transitions: Record<Invoice['kind'], Partial<Record<InvoiceState, InvoiceState[]>>> = {
  ar: { due: ['overdue', 'blocked', 'disputed'], overdue: ['in_collection', 'blocked', 'disputed'],
    in_collection: ['pending_owner', 'promised', 'escalated', 'blocked', 'disputed'],
    pending_owner: ['promised', 'blocked'], escalated: ['promised', 'blocked'],
    promised: ['partially_paid', 'paid', 'disputed'], partially_paid: ['paid', 'disputed'] },
  ap: { received: ['extracted'], extracted: ['matched', 'held'], matched: ['scheduled', 'held'],
    scheduled: ['paid', 'held'], held: ['escalated'], escalated: ['approved', 'rejected'], approved: ['scheduled'] },
};

export { AuditLog } from './audit';
export type { Agent, AuditEntry, Escalation, Invoice, Lease, Task, Step } from './store';
export { evaluateStep } from './policy-gate';

const auditedMutations = new Set<string>(['registerAgent', 'enqueueTask', 'claimTask', 'setAgentState', 'setAgentTarget', 'pauseTask', 'advanceTask', 'completeTask', 'createEscalation', 'insertInvoice', 'transitionInvoice', 'reservePayment', 'recordPayment']);
