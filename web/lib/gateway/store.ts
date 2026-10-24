import type {
  GatewayPolicyDecision,
  GatewayPolicyState,
} from "./policy-adapter";
import { getStateStore, type StateStore } from "@backroom/orchestrator";

export interface GatewayCall {
  callId: string;
  agentId?: string;
  invoiceId: string;
  clientId: string;
  contactName: string;
  companyName: string;
  amountCents: number;
  receivable: { principalCents: number; lateFeeCents: number };
  policyState?: GatewayPolicyState;
  currency: string;
  policyVersion: number;
  identityConfirmed: boolean;
  status:
    | "active"
    | "disputed"
    | "opted_out"
    | "human_requested"
    | "already_paid";
  audits: AuditEntry[];
  plans: AllowedPlan[];
  escalations: Escalation[];
  links: PaymentLink[];
  outbox: (
    | { type: "send_payment_link"; linkId: string }
    | {
        type:
          | "mark_dispute"
          | "record_opt_out"
          | "request_human"
          | "report_already_paid";
      }
  )[];
  deliveries: Record<string, { fingerprint: string }>;
}
export interface PlanTerms {
  installments: number;
  firstPaymentPct: number;
  durationDays: number;
  waiveFee: boolean;
  discountPct: number;
}
export interface AuditEntry {
  actor: "code";
  id: string;
  action: string;
  kind: "ALLOW" | "DENY" | "ESCALATE" | "RECORDED";
  ruleIds: string[];
  policyVersion: number;
  webhookRequestId: string;
  plan?: PlanTerms;
  decision?: GatewayPolicyDecision;
}
export interface AllowedPlan extends PlanTerms {
  id: string;
  auditId: string;
  totalCents: number;
  firstPaymentCents: number;
}
export interface Escalation {
  id: string;
  ruleIds: string[];
  status: "pending" | "approved" | "denied" | "counter" | "pending_owner" | "expired";
  createdAt?: number; expiresAt?: number; decidedAt?: number;
  decision?: import("@backroom/orchestrator").ControllerDecision;
  toHuman: string;
  plan?: PlanTerms;
  method?: "passkey"; // Only the trusted approval backend may set this, never a tool.
}
export interface PaymentLink {
  id: string;
  planId: string;
  auditId: string;
  amountCents: number;
  path: string;
  shortCode?: string;
  createdAt?: number;
  expiresAt?: number;
}
export interface ToolResult {
  kind: "ALLOW" | "DENY" | "ESCALATE" | "CONTEXT" | "RECORDED" | "PENDING";
  can_confirm: boolean;
  speak: string;
  [key: string]: unknown;
}
/** Adapters must commit the call, audit, outbox and dedupe record atomically,
 * serialize by callId, and enforce webhook_request_id uniqueness across calls.
 * No mutation is committed if work throws. Never expose this interface to voice.
 */
export interface GatewayStore {
  /** Trusted server-only lookup by opaque payment capability; no call IDs supplied by clients. */
  registerCall?(call: GatewayCall): Promise<void>;
  clientStopped?(clientId: string): Promise<boolean>;
  findPaymentCode?(code: string): Promise<GatewayCall | undefined>;
  activePaymentCall?(): Promise<GatewayCall | undefined>;
  /** Most recently registered live voice call (`voice:collections`), for the office's read-only projection. */
  latestVoiceCall?(): Promise<GatewayCall | undefined>;
  findPaymentCall?(linkId: string): Promise<GatewayCall | undefined>;
  transact<T>(
    callId: string,
    work: (call: GatewayCall) => T | Promise<T>,
  ): Promise<T>;
}
export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

/** Development only: single-process memory, lost on restart; not Vercel persistence. */
export class MemoryGatewayStore implements GatewayStore {
  private calls = new Map<string, GatewayCall>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(calls: GatewayCall[] = [],
    private readonly auditStore: Pick<StateStore, 'appendAudits'> | (() => Pick<StateStore, 'appendAudits'>) = getStateStore,
  ) {
    for (const call of calls)
      this.calls.set(call.callId, structuredClone(call));
  }
  async registerCall(call: GatewayCall): Promise<void> {
    const run = this.tail.then(() => {
      if (this.calls.has(call.callId)) throw new GatewayError(409, 'CALL_EXISTS');
      this.calls.set(call.callId, structuredClone(call));
    });
    this.tail = run.catch(() => undefined); return run;
  }
  async clientStopped(clientId: string) {
    await this.tail;
    return [...this.calls.values()].some(call => call.clientId === clientId && call.status !== 'active');
  }
  async findPaymentCode(code: string) {
    await this.tail;
    return structuredClone([...this.calls.values()].find(call => call.links.some(link => link.shortCode === code)));
  }
  async activePaymentCall() {
    await this.tail;
    return structuredClone([...this.calls.values()].filter(call => call.status === 'active' && call.links.length)
      .sort((a, b) => (b.links.at(-1)?.createdAt ?? 0) - (a.links.at(-1)?.createdAt ?? 0))[0]);
  }
  async latestVoiceCall() {
    await this.tail;
    return structuredClone([...this.calls.values()].filter(call => call.agentId === 'voice:collections').at(-1));
  }
  async findPaymentCall(linkId: string): Promise<GatewayCall | undefined> {
    await this.tail;
    return structuredClone([...this.calls.values()].find(call => call.links.some(link => link.id === linkId)));
  }
  async transact<T>(
    callId: string,
    work: (call: GatewayCall) => T | Promise<T>,
  ): Promise<T> {
    // Serialize all calls so a delivery ID cannot be raced across call IDs.
    const run = this.tail.then(async () => {
      const current = this.calls.get(callId);
      if (!current) throw new GatewayError(404, "CALL_NOT_FOUND");
      const copy = structuredClone(current);
      const result = await work(copy);
      for (const [otherId, other] of this.calls) {
        if (
          otherId !== callId &&
          Object.keys(copy.deliveries).some((id) =>
            Object.hasOwn(other.deliveries, id),
          )
        ) {
          throw new GatewayError(409, "WEBHOOK_ID_REUSED");
        }
      }
      // KNOWN GAP (fix after the demo, see Anthony's approved 9a0d89e): this scans `this.calls`, which still
      // holds the pre-transaction copy of `callId`. A `work` that renames a link id while keeping its short
      // code collides with its own stale row and gets a false PAYMENT_CODE_COLLISION. Conversely, two links
      // that reuse both the same id and the same short code are not caught. Don't rename link ids in `work`.
      for (const link of copy.links) {
        if (link.shortCode && [...this.calls.values()].some(other => other.links.some(row => row.id !== link.id && row.shortCode === link.shortCode)))
          throw new GatewayError(409, 'PAYMENT_CODE_COLLISION');
      }
      // Prepare every potentially throwing clone/check before appending evidence.
      // The call rows retain their existing UUIDs; the shared chain uses those
      // same IDs so gateway citations resolve through StateStore.getAudit.
      const saved = structuredClone(copy);
      const response = structuredClone(result);
      const previousIds = new Set(current.audits.map(entry => entry.id));
      const inputs = saved.audits.filter(entry => !previousIds.has(entry.id)).map(entry => ({
        id: entry.id, ts: Date.now(), actor: entry.actor, seat: 'collections' as const,
        action: entry.action, ruleIds: entry.ruleIds, policyVersion: entry.policyVersion,
        refs: [saved.callId, saved.invoiceId, saved.clientId], route: 'code',
        decision: entry.kind === 'RECORDED' ? undefined : entry.kind,
        inputs: { kind: entry.kind, webhookRequestId: entry.webhookRequestId,
          invoiceId: saved.invoiceId, plan: entry.plan, decision: entry.decision },
        latencyMs: 0, costUsd: 0,
      }));
      if (inputs.length) {
        const audit = typeof this.auditStore === 'function' ? this.auditStore() : this.auditStore;
        await audit.appendAudits(inputs);
      }
      this.calls.set(callId, saved);
      return response;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}
