import type { RuleId } from "./sentences";

export type Badge = "collections" | "payables" | "vendor_onboarding";
export interface CollectionLimits {
  maxInstallments: number;
  minFirstPct: number;
  maxPlanDays: number;
  feesWaivable: boolean;
  maxDiscountPct: number;
}
export interface Policy {
  policyVersion: number;
  owner: string;
  toHuman: string;
  badges: {
    collections: { actions: string[]; rooms: string[]; limits: CollectionLimits };
    payables: { actions: string[]; rooms: string[]; maxPaymentCents: number; account: string };
    vendor_onboarding: { actions: string[]; rooms: string[] };
  };
  callWindow: { weekdays: number[]; startHour: number; endHour: number };
  signalAdjustments: Record<string, Partial<CollectionLimits>>;
}
export type CollectionEnvelope = CollectionLimits & { payInFull: true };
export interface Plan {
  installments: number;
  firstPaymentPct: number;
  totalDays: number;
  waiveFees: boolean;
  discountPct: number;
}
export interface LineItem { description: string; quantity: number; unitPriceCents: number }
export interface APInvoice {
  id?: string;
  vendorId: string;
  amountCents: number;
  lineItems: readonly LineItem[];
  poMatched: boolean;
  account: string;
}
export type Action =
  | { type: "read_ar" | "get_invoice_context" | "verify_identity_result" | "record_opt_out" | "mark_dispute" | "report_already_paid" | "request_human" | "read_invoices" | "read_pos" | "run_crs" | "run_apify" | "propose_vendor" | "disclose_invoice" | "call_client" }
  | { type: "enter_room"; room: string }
  | { type: "propose_plan"; plan: Plan }
  | { type: "send_payment_link"; plan: Plan; amountCents: number }
  | { type: "pay_invoice"; invoice?: APInvoice }
  | { type: "propose_bank_change"; emailDomain: string };
/** A dispatcher may carry an unknown action; evaluate denies unsupported types. */
export type ActionRequest = Action | { type: string; [field: string]: unknown };
export interface Context {
  /** Omit for the bundled Northfield policy. Never populate from model output. */
  policy?: Policy;
  /** Optional optimistic-version guard; the returned version is always the policy's. */
  policyVersion?: number;
  client?: {
    type: "business" | "consumer";
    phoneNumber: string;
    consent?: { source: string; text: string; timestamp: string; number: string };
    dnc: boolean;
    /** Client-local time, computed by the caller for this evaluation. Sunday = 0. */
    localWeekday: number;
    localHour: number;
  };
  demoOverride?: { visible: boolean; logged: boolean };
  identityConfirmed?: boolean;
  signals?: {
    ofacHit?: boolean; closedBusiness?: boolean; bankruptcy?: boolean; disputed?: boolean;
    /** Names in the owner's signalAdjustments table; unknown names have no effect. */
    active?: readonly string[];
  };
  receivable?: { principalCents: number; lateFeeCents: number };
  vendor?: {
    id: string; inMaster: boolean; approved: boolean; pendingBankChange: boolean;
    knownDomain: string; sourceDomain?: string;
  };
  priorInvoices?: readonly APInvoice[];
}
export interface PolicyQuote { sentenceId: string; text: string }
interface AuditFields { ruleIds: RuleId[]; policyVersion: number }
export type Decision =
  | (AuditFields & { kind: "ALLOW" })
  | (AuditFields & { kind: "DENY"; reason: string; quote: PolicyQuote })
  | (AuditFields & { kind: "ESCALATE"; reason: string; quote: PolicyQuote; toHuman: string });
