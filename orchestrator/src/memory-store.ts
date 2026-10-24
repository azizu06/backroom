import { createHash } from 'node:crypto';
import type { Decision } from '@backroom/policy';
import type { Agent, AgentState, AuditEntry, AuditInput, Escalation, Invoice, InvoiceState,
  Lease, NewTask, PaymentReceipt, Seat, StateStore, Task } from './store';

const copy = <T>(value: T): T => structuredClone(value);
export const hashAudit = (entry: Omit<AuditEntry, 'hash'>): string =>
  createHash('sha256').update(JSON.stringify(entry)).digest('hex');

/** Single-process reducer analogue: no awaits inside read/check/write sections. */
export class MemoryStateStore implements StateStore {
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
    const task = [...this.tasks.values()].find(t => t.seatId === agent.seatId && t.status === 'queued');
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
    for (const agent of this.agents.values()) {
      if (now - agent.heartbeatAt > 15000) agent.state = 'offline';
    }
    for (const task of this.tasks.values()) {
      if (task.status !== 'in_progress') continue;
      const owner = this.agent(task.leaseOwner!);
      if (task.leaseExpiresAt! <= now || owner.state === 'offline') {
        this.append({ ts: now, actor: 'system', seat: task.seatId, action: 'lease_expired',
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
      evidenceRefs: [...task.refs], status: 'pending' };
    this.escalations.set(escalation.id, escalation); task.escalationId = escalation.id;
    return copy(escalation);
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
  waiting: ['waiting', 'walking', 'on_call'], on_call: ['working', 'walking', 'on_call'], offline: [],
};

const transitions: Record<Invoice['kind'], Partial<Record<InvoiceState, InvoiceState[]>>> = {
  ar: { due: ['overdue', 'blocked', 'disputed'], overdue: ['in_collection', 'blocked', 'disputed'],
    in_collection: ['pending_owner', 'promised', 'escalated', 'blocked', 'disputed'],
    pending_owner: ['promised', 'blocked'], escalated: ['promised', 'blocked'],
    promised: ['partially_paid', 'paid', 'disputed'], partially_paid: ['paid', 'disputed'] },
  ap: { received: ['extracted'], extracted: ['matched', 'held'], matched: ['scheduled', 'held'],
    scheduled: ['paid', 'held'], held: ['escalated'], escalated: ['approved', 'rejected'], approved: ['scheduled'] },
};
