import type { Action, Badge, Context, Decision } from '@backroom/policy';

export type Seat = Badge;
export type AgentState = 'idle' | 'working' | 'walking' | 'waiting' | 'on_call' | 'offline';
export interface Agent {
  id: string; seatId: Seat; state: AgentState; room: string; targetAnchor?: string;
  pos: { x: number; y: number; z: number }; heartbeatAt: number;
  currentTaskId?: string; modelRoute: string;
}
export type EffectKind = 'dial' | 'crs' | 'apify' | 'nessie';
export interface Step {
  kind: EffectKind; action: Action; context: Context; input: Record<string, unknown>;
}
export interface NewTask {
  id: string; seatId: Seat; refs: string[]; steps: Step[]; idempotencyKey?: string;
}
export interface Task extends NewTask {
  kind: string; status: 'queued' | 'in_progress' | 'done' | 'denied' | 'failed';
  leaseOwner?: string; leaseExpiresAt?: number; leaseToken: number;
  cursor: number; escalationId?: string;
}
export interface Lease extends Task { leaseOwner: string; leaseExpiresAt: number }
export interface Escalation {
  id: string; taskId: string; fromAgent: string; toHuman: string; ruleIds: string[];
  evidenceRefs: string[]; status: 'pending' | 'approved' | 'denied';
  decision?: string; decidedAt?: number; method?: 'passkey';
}
export interface AuditInput {
  ts: number; actor: 'code' | 'local_model' | 'claude' | 'human' | 'client' | 'system';
  seat: Seat; action: string; ruleIds: string[]; policyVersion: number; refs: string[];
  route: string; decision?: Decision['kind']; inputs?: Record<string, unknown>;
  latencyMs: number; costUsd: number;
}
export interface AuditEntry extends AuditInput { seq: number; id: string; prevHash: string; hash: string }
export interface PaymentReceipt { key: string; fingerprint: string; result: Record<string, unknown> }
export type InvoiceState = 'due' | 'overdue' | 'in_collection' | 'pending_owner' | 'promised'
  | 'partially_paid' | 'paid' | 'blocked' | 'disputed' | 'escalated' | 'received' | 'extracted'
  | 'matched' | 'scheduled' | 'held' | 'approved' | 'rejected';
export interface Invoice { id: string; kind: 'ar' | 'ap'; state: InvoiceState }

/** Reducers must be atomic. A remote adapter uses database time, never untrusted client time.
 * Every task mutation checks the owner, fencing token, and unexpired lease together.
 * appendAudit is append-only and assigns sequence/hash atomically.
 */
export interface StateStore {
  registerAgent(id: string, seat: Seat, now: number): Promise<void>;
  getAgent(id: string): Promise<Agent | undefined>;
  heartbeat(id: string, now: number): Promise<void>;
  enqueueTask(task: NewTask): Promise<void>;
  getTask(id: string): Promise<Task | undefined>;
  claimTask(agentId: string, now: number, leaseMs: number): Promise<Lease | undefined>;
  renewLease(lease: Lease, now: number, leaseMs: number): Promise<void>;
  assertLease(lease: Lease, now: number): Promise<void>;
  reapExpired(now: number): Promise<void>;
  setAgentState(lease: Lease, state: AgentState, now: number): Promise<void>;
  setAgentTarget(lease: Lease, targetAnchor: string, now: number): Promise<void>;
  advanceTask(lease: Lease, now: number): Promise<void>;
  completeTask(lease: Lease, status: 'done' | 'denied' | 'failed', now: number): Promise<void>;
  createEscalation(lease: Lease, decision: Extract<Decision, { kind: 'ESCALATE' }>, now: number): Promise<Escalation>;
  getEscalation(id: string): Promise<Escalation | undefined>;
  // Approval writes belong to the controller/passkey service, not to workers.
  appendAudit(entry: AuditInput): Promise<AuditEntry>;
  listAudit(): Promise<AuditEntry[]>;
  getPayment(key: string): Promise<PaymentReceipt | undefined>;
  reservePayment(lease: Lease, key: string, fingerprint: string, now: number): Promise<PaymentReceipt | undefined>;
  recordPayment(lease: Lease, receipt: PaymentReceipt, now: number): Promise<void>;
  insertInvoice(invoice: Invoice): Promise<void>;
  transitionInvoice(lease: Lease, id: string, from: InvoiceState, to: InvoiceState, now: number): Promise<void>;
}

export { MemoryStateStore } from './memory-store';
