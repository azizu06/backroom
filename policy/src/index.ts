import { isDomain, isDuplicate, isLookalike } from "./ap";
import { DEFAULT_POLICY, computeEnvelope, validPolicy, CRS_FRAUD_RISK_THRESHOLD } from "./config";
export { DEFAULT_POLICY, savePolicy, computeEnvelope, CRS_FRAUD_RISK_THRESHOLD } from "./config";
import { POLICY_SENTENCES, RULE_SENTENCES, type RuleId } from "./sentences";
import type { Badge, Action, ActionRequest, Context, Decision, Policy, Plan } from "./types";
export type * from "./types";
export { POLICY_SENTENCES, RULE_SENTENCES, type RuleId } from "./sentences";

/** NF-027 first installment. Rounded up to a whole dollar for the integer-only bank, never above the total; later installments absorb the difference. */
export function firstPaymentCents(totalCents: number, firstPaymentPct: number, installments: number): number {
  if (installments === 1) return totalCents;
  return Math.min(totalCents, Math.ceil(Math.round(totalCents * firstPaymentPct / 100) / 100) * 100);
}

function block(policy: Policy, rule: RuleId, kind: "DENY" | "ESCALATE", message: string): Decision {
  const sentenceId = RULE_SENTENCES[rule];
  const limits = policy.badges.collections.limits;
  const saved: Partial<Record<RuleId, string>> = {
    MAX_INSTALLMENTS: `maximum installment count: ${limits.maxInstallments}`,
    MIN_FIRST_PCT: `minimum first-payment percentage: ${limits.minFirstPct}%`,
    MAX_PLAN_DAYS: `maximum plan duration: ${limits.maxPlanDays} days`,
    OVER_LIMIT: `Payables limit: $${(policy.badges.payables.maxPaymentCents / 100).toFixed(2)}`,
  };
  const annotation = policy.policyVersion > 1 && saved[rule] ? ` Saved ${saved[rule]} in v${policy.policyVersion}.` : '';
  const quote = { sentenceId, text: POLICY_SENTENCES[sentenceId] + annotation };
  const fields = { ruleIds: [rule], policyVersion: policy.policyVersion, quote,
    reason: `${message.replace(/\bDana\b/g, () => policy.toHuman)} Your policy says: “${quote.text}”` };
  return kind === "DENY" ? { kind, ...fields } : { kind, ...fields, toHuman: policy.toHuman };
}

export function evaluate(badge: Badge, request: ActionRequest, context: Context): Decision {
  // Unknown types fail the badge check; typed payloads are validated before use.
  const action = request as Action;
  const policy = context.policy ?? DEFAULT_POLICY;
  if (!validPolicy(policy)) {
    const safeVersion = Number.isSafeInteger(policy?.policyVersion) && policy.policyVersion >= 1 ? policy.policyVersion : DEFAULT_POLICY.policyVersion;
    return block({ ...DEFAULT_POLICY, policyVersion: safeVersion }, "INVALID_INPUT", "DENY", "The saved policy is invalid.");
  }
  if (context.policyVersion !== undefined && context.policyVersion !== policy.policyVersion) {
    return block(policy, "INVALID_INPUT", "DENY", "The policy version has changed.");
  }
  const seat = Object.hasOwn(policy.badges, badge) ? policy.badges[badge] : undefined;
  if (!seat || (action.type === "enter_room" ? !seat.rooms.includes(action.room) : !seat.actions.includes(action.type))) {
    return block(policy, "NOT_IN_BADGE", "DENY", "This action is outside my badge.");
  }
  const rules: RuleId[] = ["IN_BADGE"];
  const collecting = ["call_client", "propose_plan", "send_payment_link", "disclose_invoice"].includes(action.type);
  if (collecting || action.type === "pay_invoice") {
    if (context.signals?.ofacHit) return block(policy, "OFAC_STOP", "ESCALATE", "I need Dana to review the sanctions hit.");
  }
  if (collecting) {
    if (context.signals?.closedBusiness) return block(policy, "CLOSED_BUSINESS_STOP", "ESCALATE", "Collections must stop for this closed business.");
    if (context.signals?.bankruptcy) return block(policy, "BANKRUPTCY_STOP", "ESCALATE", "Collections must stop for bankruptcy review.");
    if (context.signals?.disputed) return block(policy, "DISPUTE_STOP", "ESCALATE", "I need Dana to review this dispute.");
  }
  if (action.type === "call_client") {
    const client = context.client;
    const consent = client?.consent;
    if (!consent || ![consent.source, consent.text, consent.timestamp, consent.number].every(nonempty)
      || !Number.isFinite(Date.parse(consent.timestamp)) || consent.number !== client?.phoneNumber) {
      return block(policy, "CONSENT_REQUIRED", "DENY", "I need a complete consent record for this number before calling.");
    }
    if (client?.type !== "business") return block(policy, "B2B_ONLY_CALLS", "DENY", "I can call business clients only.");
    if (client.dnc !== false) return block(policy, "DNC", "DENY", "I cannot call a client who has opted out.");
    if (!Number.isInteger(client.localWeekday) || client.localWeekday < 0 || client.localWeekday > 6
      || !Number.isFinite(client.localHour) || client.localHour < 0 || client.localHour >= 24) {
      return block(policy, "INVALID_INPUT", "DENY", "I need the client's valid local time before calling.");
    }
    const window = policy.callWindow;
    const inside = Number.isInteger(client.localWeekday) && window.weekdays.includes(client.localWeekday)
      && Number.isFinite(client.localHour) && client.localHour >= window.startHour && client.localHour < window.endHour;
    if (!inside) {
      if (context.demoOverride?.visible === true && context.demoOverride.logged === true) rules.push("DEMO_OVERRIDE");
      else return block(policy, "CALL_WINDOW", "DENY", "This is outside the client's calling hours.");
    }
  }
  if (["get_invoice_context", "disclose_invoice", "propose_plan", "send_payment_link"].includes(action.type) && context.identityConfirmed !== true) {
    return block(policy, "IDENTITY_REQUIRED", "DENY", "I need to confirm your identity first.");
  }
  if (action.type === "propose_plan" || action.type === "send_payment_link") {
    const plan = action.plan;
    if (!validPlan(plan)) return block(policy, "INVALID_INPUT", "DENY", "This plan is incomplete or invalid.");
    const limits = computeEnvelope(policy, context.signals?.active);
    if (context.signals?.active?.length) rules.push("SIGNALS_ONLY_NARROW");
    if (plan.waiveFees && !limits.feesWaivable) return block(policy, "FEES_NON_WAIVABLE", "DENY", "I cannot waive the late fee.");
    if (plan.installments > limits.maxInstallments) return block(policy, "MAX_INSTALLMENTS", "ESCALATE", "I need Dana's approval for that many installments.");
    if (plan.firstPaymentPct < limits.minFirstPct) return block(policy, "MIN_FIRST_PCT", "ESCALATE", "I need Dana's approval for a smaller first payment.");
    if (plan.totalDays > limits.maxPlanDays) return block(policy, "MAX_PLAN_DAYS", "ESCALATE", "I need Dana's approval for a longer plan.");
    if (plan.discountPct > limits.maxDiscountPct) return block(policy, "MAX_DISCOUNT", "ESCALATE", "I need Dana's approval for that discount.");
    if (action.type === "send_payment_link") {
      const invoice = context.receivable;
      if (!invoice || !cents(invoice.principalCents) || !cents(invoice.lateFeeCents)) {
        return block(policy, "INVALID_INPUT", "DENY", "I need a valid invoice before creating a link.");
      }
      const total = Math.round(invoice.principalCents * (1 - plan.discountPct / 100)) + (plan.waiveFees ? 0 : invoice.lateFeeCents);
      const first = firstPaymentCents(total, plan.firstPaymentPct, plan.installments);
      if (!cents(action.amountCents) || action.amountCents !== first || first === 0) {
        return block(policy, "LINK_AMOUNT", "DENY", "This link does not match the approved first installment.");
      }
    }
  }
  if (action.type === "pay_invoice" || action.type === "propose_bank_change") {
    const vendor = context.vendor;
    if (!vendor || !nonempty(vendor.id) || !isDomain(vendor.knownDomain)) {
      return block(policy, "INVALID_INPUT", "DENY", "I need a valid vendor record.");
    }
    const score = context.signals?.fraudRiskScore;
    if (score !== undefined && (!Number.isFinite(score) || score < 0 || score > 100)) return block(policy, "INVALID_INPUT", "DENY", "The CRS fraud risk is invalid.");
    if (score !== undefined && score >= CRS_FRAUD_RISK_THRESHOLD) return block(policy, "FRAUD_RISK_HOLD", "ESCALATE", "Dana must review the CRS fraud risk before this bank change or payment.");
    const source = action.type === "propose_bank_change" ? action.emailDomain : vendor.sourceDomain;
    if ((action.type === "propose_bank_change" || source !== undefined) && !isDomain(source)) return block(policy, "INVALID_INPUT", "DENY", "I need a valid sender domain.");
    if (source && isLookalike(vendor.knownDomain, source)) {
      return block(policy, "LOOKALIKE_DOMAIN", "ESCALATE", "This sender's domain resembles the vendor's domain; Dana must verify it.");
    }
    if (action.type === "propose_bank_change" || vendor.pendingBankChange !== false) {
      return block(policy, "BANK_CHANGE_HOLD", "ESCALATE", "Dana must verify and approve this bank change before payment.");
    }
    const invoice = action.invoice;
    if (!invoice || !cents(invoice.amountCents) || invoice.amountCents === 0 || !nonempty(invoice.vendorId)
      || !Array.isArray(invoice.lineItems) || invoice.lineItems.length === 0
      || !invoice.lineItems.every(item => item && nonempty(item.description) && Number.isFinite(item.quantity) && item.quantity > 0 && cents(item.unitPriceCents))) {
      return block(policy, "INVALID_INPUT", "DENY", "This invoice is incomplete or invalid.");
    }
    if (vendor.inMaster !== true || vendor.approved !== true || vendor.id !== invoice.vendorId) {
      return block(policy, "PAYEE_NOT_IN_MASTER", "ESCALATE", "Dana must verify this payee against the approved vendor master.");
    }
    if (context.priorInvoices?.some(prior => isDuplicate(invoice, prior))) return block(policy, "DUPLICATE_INVOICE", "ESCALATE", "This looks like an invoice already received.");
    if (invoice.amountCents > policy.badges.payables.maxPaymentCents) return block(policy, "OVER_LIMIT", "ESCALATE", "This payment needs Dana's approval because it exceeds my limit.");
    if (invoice.poMatched !== true) return block(policy, "NO_PO", "ESCALATE", "Dana must review the missing purchase order match.");
    if (invoice.account !== policy.badges.payables.account) return block(policy, "OPERATING_ACCOUNT_ONLY", "DENY", "I can pay only from the operating account.");
  }
  return { kind: "ALLOW", ruleIds: rules, policyVersion: policy.policyVersion };
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function cents(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
function validPlan(plan: Plan): boolean {
  return !!plan && Number.isSafeInteger(plan.installments) && plan.installments >= 1
    && Number.isFinite(plan.firstPaymentPct) && plan.firstPaymentPct > 0 && plan.firstPaymentPct <= 100
    && Number.isSafeInteger(plan.totalDays) && plan.totalDays >= 0 && typeof plan.waiveFees === "boolean"
    && Number.isFinite(plan.discountPct) && plan.discountPct >= 0 && plan.discountPct <= 100
    && (plan.installments !== 1 || (plan.firstPaymentPct === 100 && plan.totalDays === 0))
    && (plan.installments === 1 || plan.firstPaymentPct < 100);
}
