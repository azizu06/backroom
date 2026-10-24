import { consumeVerifiedApproval, type VerifiedApproval } from './approvals/verified';
import { createHash } from 'node:crypto';
import type { Decision } from '@backroom/policy';
import type { Agent, AgentState, AuditEntry, AuditInput, Escalation, Invoice, InvoiceState,
  CallEscalation, Lease, NewTask, PaymentReceipt, Seat, StateStore, Task } from './store';

const copy = <T>(value: T): T => structuredClone(value);
export const hashAudit = (entry: Omit<AuditEntry, 'hash'>): string =>
  createHash('sha256').update(JSON.stringify(entry)).digest('hex');

/** Single-process reducer analogue: no awaits inside read/check/write sections. */
export class MemoryStateStore implements StateStore {
  private modelController = new AbortController();
  private modelsEnabled = true;
  get llmEnabled() { return this.modelsEnabled; }
  get llmSignal() { return this.modelController.signal; }
  async setLlmEnabled(enabled: boolean) {
    if (typeof enabled !== 'boolean') throw new Error('INVALID_LLM_ENABLED');
    if (enabled === this.modelsEnabled) return;
    this.modelsEnabled = enabled;
    if (enabled) this.modelController = new AbortController();
    else this.modelController.abort('LLM_OFF');
    this.append({ ts: Date.now(), actor: 'code', seat: 'controller', action: 'set_llm_enabled',
      ruleIds: ['LLM_SWITCH'], policyVersion: 0, refs: ['runtime_control:global'], route: 'code',
      inputs: { llmEnabled: enabled }, latencyMs: 0, costUsd: 0 });
  }
  private agents = new Map<string, Agent>();
  private tasks = new Map<string, Task>();
  private escalations = new Map<string, Escalation>();
  private audit: AuditEntry[] = [];
  private payments = new Map<string, PaymentReceipt>();
  private paymentFingerprints = new Map<string, string>();
  private invoices = new Map<string, Invoice>();

  async registerAgent(id: string, seatId: Seat, now: number): Promise<void> {
    if (this.agents.has(id)) throw new Error('AGENT_EXISTS');
    this.agents.set(id, { id, seatId, state: 'idle', room: seatId,
      pos: { x: 0, y: 0, z: 0 }, heartbeatAt: now, modelRoute: 'code' });
  }
  async getAgent(id: string) { return copy(this.agents.get(id)); }
  async getTask(id: string) { return copy(this.tasks.get(id)); }
  async heartbeat(id: string, now: number) {
    this.reap(now);
    const agent = this.agent(id);
    agent.heartbeatAt = now;
    if (agent.state === 'offline') agent.state = 'idle';
  }
  async enqueueTask(input: NewTask) {
    if (this.tasks.has(input.id)) throw new Error('TASK_EXISTS');
    if (input.steps.filter(step => step.kind === 'nessie').length > 1) throw new Error('ONE_PAYMENT_PER_TASK');
    if (input.steps.some(step => step.kind === 'nessie') && !input.idempotencyKey) throw new Error('PAYMENT_KEY_REQUIRED');
    this.tasks.set(input.id, { ...copy(input), kind: input.steps[0]?.kind ?? 'noop',
      status: 'queued', leaseToken: 0, cursor: 0 });
  }
  async claimTask(agentId: string, now: number, leaseMs: number): Promise<Lease | undefined> {
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
  async assertLease(lease: Lease, now: number) { this.owned(lease, now); }
  async renewLease(lease: Lease, now: number, leaseMs: number) {
    this.owned(lease, now).leaseExpiresAt = now + leaseMs;
  }
  async reapExpired(now: number) { this.reap(now); }
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
  async setAgentState(lease: Lease, state: AgentState, now: number) {
    const task = this.owned(lease, now);
    const agent = this.agent(lease.leaseOwner);
    if (!agentTransitions[agent.state].includes(state) || (state === 'waiting' && !task.escalationId)) {
      throw new Error('INVALID_AGENT_TRANSITION');
    }
    agent.state = state;
  }
  async setAgentTarget(lease: Lease, targetAnchor: string, now: number) {
    this.owned(lease, now);
    const agent = this.agent(lease.leaseOwner);
    if (!agentTransitions[agent.state].includes('walking')) throw new Error('INVALID_AGENT_TRANSITION');
    agent.state = 'walking'; agent.targetAnchor = targetAnchor;
  }
  async pauseTask(lease: Lease, now: number) {
    const task = this.owned(lease, now);
    task.status = 'paused'; task.leaseOwner = undefined; task.leaseExpiresAt = undefined;
    const agent = this.agent(lease.leaseOwner);
    agent.state = 'paused'; agent.currentTaskId = undefined; agent.targetAnchor = undefined;
  }
  async advanceTask(lease: Lease, now: number) { this.owned(lease, now).cursor++; }
  async completeTask(lease: Lease, status: 'done' | 'denied' | 'failed', now: number) {
    const task = this.owned(lease, now);
    task.status = status; task.leaseOwner = undefined; task.leaseExpiresAt = undefined;
    const agent = this.agent(lease.leaseOwner);
    agent.state = 'idle'; agent.currentTaskId = undefined; agent.targetAnchor = undefined;
  }
  async createEscalation(lease: Lease, decision: Extract<Decision, { kind: 'ESCALATE' }>, now: number) {
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
  async createCallEscalation(input: CallEscalation, now: number): Promise<Escalation> {
    const existing = this.escalations.get(input.id);
    if (existing) return copy(existing);
    const { seat, ...fields } = copy(input);
    let agent = this.agents.get(input.fromAgent);
    if (!agent) {
      agent = { id: input.fromAgent, seatId: seat, state: 'on_call', room: seat,
        pos: { x: 0, y: 0, z: 0 }, heartbeatAt: now, modelRoute: 'code' };
      this.agents.set(agent.id, agent);
    }
    const escalation: Escalation = { ...fields, createdAt: now, expiresAt: now + 60_000, status: 'pending' };
    this.escalations.set(escalation.id, escalation);
    agent.state = 'walking'; agent.targetAnchor = `${input.toHuman}_desk`;
    this.append({ ts: now, actor: 'code', seat, action: 'create_escalation', ruleIds: input.ruleIds,
      policyVersion: input.policyVersion, refs: [input.id, ...input.evidenceRefs], route: 'code',
      decision: 'ESCALATE', latencyMs: 0, costUsd: 0 });
    return copy(escalation);
  }
  async decideEscalation(approval: VerifiedApproval, now: number): Promise<Escalation> {
    const verified = consumeVerifiedApproval(approval);
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
  async expireEscalations(now: number) { this.expire(now); }
  private expire(now: number) {
    for (const escalation of this.escalations.values()) {
      if (escalation.status !== 'pending' || now < escalation.expiresAt) continue;
      escalation.status = 'pending_owner';
      const invoice = escalation.invoiceId && this.invoices.get(escalation.invoiceId);
      if (invoice && invoice.kind === 'ar' && ['in_collection', 'escalated'].includes(invoice.state)) invoice.state = 'pending_owner';
      this.append({ ts: now, actor: 'system', seat: this.agents.get(escalation.fromAgent)?.seatId ?? 'collections',
        action: 'pending_owner', ruleIds: escalation.ruleIds, policyVersion: escalation.policyVersion,
        refs: [escalation.id, ...escalation.evidenceRefs], route: 'code', latencyMs: 0, costUsd: 0 });
    }
  }
  async getEscalation(id: string) { return copy(this.escalations.get(id)); }
  async appendAudit(input: AuditInput) {
    return this.append(input);
  }
  private append(input: AuditInput) {
    const body = { ...copy(input), seq: this.audit.length + 1, id: `audit:${this.audit.length + 1}`,
      prevHash: this.audit.at(-1)?.hash ?? '0'.repeat(64) };
    const entry = { ...body, hash: hashAudit(body) }; this.audit.push(entry);
    return copy(entry);
  }
  async listAudit() { return copy(this.audit); }
  async getPayment(key: string) { return copy(this.payments.get(key)); }
  async reservePayment(lease: Lease, key: string, fingerprint: string, now: number) {
    const task = this.owned(lease, now);
    if (!key || task.idempotencyKey !== key) throw new Error('PAYMENT_KEY_REQUIRED');
    const prior = this.paymentFingerprints.get(key);
    if (prior !== undefined && prior !== fingerprint) throw new Error('PAYMENT_KEY_CONFLICT');
    this.paymentFingerprints.set(key, fingerprint);
    return copy(this.payments.get(key));
  }
  async recordPayment(lease: Lease, receipt: PaymentReceipt, now: number) {
    const task = this.owned(lease, now);
    if (task.idempotencyKey !== receipt.key || this.paymentFingerprints.get(receipt.key) !== receipt.fingerprint) {
      throw new Error('PAYMENT_KEY_CONFLICT');
    }
    const existing = this.payments.get(receipt.key);
    if (existing && existing.fingerprint !== receipt.fingerprint) throw new Error('PAYMENT_KEY_CONFLICT');
    this.payments.set(receipt.key, copy(existing ?? receipt));
  }
  async insertInvoice(invoice: Invoice) {
    if (this.invoices.has(invoice.id)) throw new Error('INVOICE_EXISTS');
    this.invoices.set(invoice.id, copy(invoice));
  }
  async transitionInvoice(lease: Lease, id: string, from: InvoiceState, to: InvoiceState, now: number) {
    this.owned(lease, now);
    const invoice = this.invoices.get(id);
    if (!invoice || invoice.state !== from || !transitions[invoice.kind][from]?.includes(to)) {
      throw new Error('INVALID_INVOICE_TRANSITION');
    }
    invoice.state = to;
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
