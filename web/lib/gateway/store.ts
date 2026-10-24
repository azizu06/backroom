export interface GatewayCall {
  callId: string;
  invoiceId: string;
  clientId: string;
  contactName: string;
  companyName: string;
  amountCents: number;
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
  id: string;
  action: string;
  kind: "ALLOW" | "DENY" | "ESCALATE" | "RECORDED";
  ruleIds: string[];
  policyVersion: number;
  webhookRequestId: string;
  plan?: PlanTerms;
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
  status: "pending" | "approved" | "denied" | "counter";
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
  constructor(calls: GatewayCall[] = []) {
    for (const call of calls)
      this.calls.set(call.callId, structuredClone(call));
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
      this.calls.set(callId, structuredClone(copy));
      return structuredClone(result);
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}
