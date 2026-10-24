import type { ControllerDecision, ApprovalTerms } from './approvals/types';
import type { VerifiedApproval } from './approvals/verified';
import type { Action, Badge, Context, Decision, Policy } from '@backroom/policy';
import type { ChainStatus } from './audit';

export interface PolicyLimits {
  maxInstallments: number; minFirstPct: number; maxPlanDays: number; maxPaymentCents: number;
}
export type Seat = Badge;
export type AgentState = 'idle' | 'working' | 'walking' | 'waiting' | 'on_call' | 'paused' | 'offline';
export interface Agent {
  id: string; seatId: Seat; state: AgentState; room: string; targetAnchor?: string;
  pos: { x: number; y: number; z: number }; heartbeatAt: number;
  currentTaskId?: string; modelRoute: string;
}
export type EffectKind = 'dial' | 'crs' | 'apify' | 'nessie';
export interface Step {
  requiresModel?: boolean;
  kind: EffectKind; action: Action; context: Context; input: Record<string, unknown>;
}
export interface NewTask {
  id: string; seatId: Seat; refs: string[]; steps: Step[]; idempotencyKey?: string;
}
export interface Task extends NewTask {
  kind: string; status: 'queued' | 'paused' | 'in_progress' | 'done' | 'denied' | 'failed';
  leaseOwner?: string; leaseExpiresAt?: number; leaseToken: number;
  cursor: number; escalationId?: string;
}
export interface Lease extends Task { leaseOwner: string; leaseExpiresAt: number }
export interface Escalation {
  id: string; taskId: string; fromAgent: string; toHuman: string; ruleIds: string[];
  evidenceRefs: string[]; status: 'pending' | 'approved' | 'denied' | 'counter' | 'pending_owner' | 'expired';
  createdAt: number; expiresAt: number; policyVersion: number;
  quote: { sentenceId: string; text: string };
  callId?: string; invoiceId?: string; amountCents?: number; currency?: string;
  principalCents?: number; lateFeeCents?: number; requestedTerms?: ApprovalTerms;
  decision?: ControllerDecision; decidedAt?: number; method?: 'passkey'; credentialId?: string;
}
export type CallEscalation = Omit<Escalation, 'status' | 'decision' | 'decidedAt' | 'method' | 'credentialId' | 'createdAt' | 'expiresAt'> & { seat: Seat };
export interface AuditInput {
  /** Optional stable event id for gateway dedupe; otherwise audit:<seq>. */
  id?: string;
  ts: number; actor: 'code' | 'local_model' | 'claude' | 'human' | 'client' | 'system';
  seat: Seat | 'controller'; action: string; ruleIds: string[]; policyVersion: number; refs: string[];
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
  /** Immutable snapshots; omitted version reads the current policy. */
  getPolicy(version?: number): Promise<Policy>;
  /** Trusted owner transport only. Atomically compare version, append snapshot + human audit.
   * Never expose this reducer through agent/voice tool schemas. */
  savePolicyLimits(expectedVersion: number, limits: PolicyLimits, now: number): Promise<Policy>;
  /** Global model gate; adapters map to runtime_control[global] in #15. */
  readonly llmEnabled: boolean;
  /** Aborted on OFF; a new signal on ON fences results from the old generation. */
  readonly llmSignal: AbortSignal;
  setLlmEnabled(enabled: boolean): Promise<void>;
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
  pauseTask(lease: Lease, now: number): Promise<void>;
  advanceTask(lease: Lease, now: number): Promise<void>;
  completeTask(lease: Lease, status: 'done' | 'denied' | 'failed', now: number): Promise<void>;
  createEscalation(lease: Lease, decision: Extract<Decision, { kind: 'ESCALATE' }>, now: number): Promise<Escalation>;
  getEscalation(id: string): Promise<Escalation | undefined>;
  createCallEscalation(input: CallEscalation, now: number): Promise<Escalation>;
  decideEscalation(approval: VerifiedApproval, now: number): Promise<Escalation>;
  /** Closes due rows. Pass callId when that live call has ended so its pending rows close immediately. */
  expireEscalations(now: number, callId?: string): Promise<void>;
  // Approval writes belong to the controller/passkey service, not to workers.
  appendAudit(entry: AuditInput): Promise<AuditEntry>;
  /** Atomic batch: either every entry is appended in order or none are. */
  appendAudits(entries: readonly AuditInput[]): Promise<AuditEntry[]>;
  listAudit(sinceSeq?: number): Promise<AuditEntry[]>;
  getAudit(id: string): Promise<AuditEntry | undefined>;
  verifyAuditChain(): Promise<ChainStatus>;
  getPayment(key: string): Promise<PaymentReceipt | undefined>;
  reservePayment(lease: Lease, key: string, fingerprint: string, now: number): Promise<PaymentReceipt | undefined>;
  recordPayment(lease: Lease, receipt: PaymentReceipt, now: number): Promise<void>;
  insertInvoice(invoice: Invoice): Promise<void>;
  transitionInvoice(lease: Lease, id: string, from: InvoiceState, to: InvoiceState, now: number): Promise<void>;
}

export { MemoryStateStore } from './memory-store';
