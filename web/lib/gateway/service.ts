import { randomUUID, randomBytes } from "node:crypto";
import type { Invocation } from "./parser";
import {
  DANA_APPROVED,
  decidePlan,
  type ApprovedDecision,
  type DecidePlan,
  type GatewayPolicyDecision,
} from "./policy-adapter";
import type { AuditEntry, Escalation, GatewayCall, PlanTerms, ToolResult } from "./store";

const sameTerms = (a: PlanTerms, b: PlanTerms) =>
  a.installments === b.installments &&
  a.firstPaymentPct === b.firstPaymentPct &&
  a.durationDays === b.durationDays &&
  a.waiveFee === b.waiveFee &&
  a.discountPct === b.discountPct;
/** Plan-term limits Dana may lift. Stop signals (OFAC, closed business, bankruptcy, dispute) never unlock. */
const TERM_RULES = new Set<string>(["MAX_INSTALLMENTS", "MIN_FIRST_PCT", "MAX_PLAN_DAYS", "MAX_DISCOUNT"]);
/** Dana's verified passkey decision on this call names exactly these terms: her approval or her counter. */
const authorizingEscalation = (call: GatewayCall, plan: PlanTerms) =>
  call.escalations.find(
    (e) =>
      e.method === "passkey" &&
      ((e.status === "approved" && e.decision?.kind === "Approve" && e.plan !== undefined && sameTerms(e.plan, plan)) ||
        (e.status === "counter" && e.decision?.kind === "Counter" && sameTerms(e.decision.terms, plan))),
  );
/** Policy still runs first. Only its term-limit ESCALATE becomes ALLOW, and only for the authorized terms; DENY never does. */
const withApproval =
  (decide: DecidePlan) =>
  (call: GatewayCall, plan: PlanTerms, paymentAmountCents?: number): GatewayPolicyDecision => {
    const decision = decide(call, plan, paymentAmountCents);
    if (decision.kind !== "ESCALATE" || !decision.ruleIds.every((rule) => TERM_RULES.has(rule))) return decision;
    const approval = authorizingEscalation(call, plan);
    return approval
      ? { kind: "ALLOW", policyVersion: decision.policyVersion, ruleIds: [...decision.ruleIds, DANA_APPROVED], escalationId: approval.id }
      : decision;
  };
const danaApproved = (decision: GatewayPolicyDecision): decision is ApprovedDecision =>
  decision.kind === "ALLOW" && "escalationId" in decision;
/** Records the ALLOW and mints the plan; amounts are code-computed from the authorized terms (NF-027). */
function authorizePlan(
  call: GatewayCall,
  input: Invocation,
  terms: PlanTerms,
  decision: Extract<GatewayPolicyDecision, { kind: "ALLOW" }>,
): ToolResult {
  const entry = audit(call, input, "ALLOW", decision.ruleIds, terms, decision);
  const totalCents =
    Math.round(call.receivable.principalCents * (1 - terms.discountPct / 100)) +
    (terms.waiveFee ? 0 : call.receivable.lateFeeCents);
  const plan = {
    ...terms,
    id: randomUUID(),
    auditId: entry.id,
    totalCents,
    firstPaymentCents:
      terms.installments === 1 ? totalCents : Math.round((totalCents * terms.firstPaymentPct) / 100),
  };
  call.plans.push(plan);
  return {
    kind: "ALLOW",
    can_confirm: true,
    speak: danaApproved(decision)
      ? "Dana approved these exact terms. Confirm this plan with the caller now and offer to send the payment link."
      : "Those terms are authorized. You may confirm this exact plan.",
    rule_ids: decision.ruleIds,
    audit_id: entry.id,
    plan_id: plan.id,
    plan,
  };
}
const deny = (rule: string, speak: string): ToolResult => ({
  kind: "DENY",
  can_confirm: false,
  speak,
  rule_ids: [rule],
});
/** One open escalation per call. After one expires, the same terms may be sent once more. */
function repeatEscalation(
  call: GatewayCall,
  plan: PlanTerms,
): { rule: string; speak: string } | undefined {
  if (call.escalations.some((escalation) => escalation.status === "pending")) {
    return {
      rule: "ESCALATION_OPEN",
      speak: "Dana is already reviewing a request on this call. I will keep waiting.",
    };
  }
  const same = call.escalations.filter(
    (escalation) => escalation.plan && sameTerms(escalation.plan, plan),
  );
  const closed = same.filter(
    (escalation) =>
      escalation.status === "expired" || escalation.status === "pending_owner",
  );
  if (closed.length >= 1 && same.length >= 2) {
    return {
      rule: "ESCALATION_RETRY_USED",
      speak:
        "I already asked Dana again for those terms. I cannot send another request on this call.",
    };
  }
  return undefined;
}
function closedApproval(call: GatewayCall, escalation: Escalation): ToolResult {
  const same = escalation.plan
    ? call.escalations.filter(
        (row) => row.plan && sameTerms(row.plan, escalation.plan!),
      )
    : [escalation];
  const waiting = call.escalations.some((row) => row.status === "pending");
  const mayReask = !waiting && same.length < 2;
  return {
    kind: "RECORDED",
    can_confirm: false,
    approval_status: escalation.status === "pending_owner" ? "pending_owner" : "expired",
    may_reask: mayReask,
    speak: waiting
      ? "Dana is already reviewing a request on this call. I will keep waiting."
      : mayReask
        ? "That approval request is closed. If the caller asks to send it again, call propose_plan again with those exact terms. If they have not asked, ask once. You cannot approve it yourself."
        : "That approval request is closed, and Dana was already asked again on this call. Do not send another request. You cannot approve it yourself.",
  };
}
function audit(
  call: GatewayCall,
  input: Invocation,
  kind: AuditEntry["kind"],
  ruleIds: string[],
  plan?: PlanTerms,
  decision?: GatewayPolicyDecision,
): AuditEntry {
  const entry: AuditEntry = {
    actor: "code",
    id: randomUUID(),
    action: input.tool,
    kind,
    ruleIds,
    policyVersion: decision?.policyVersion ?? call.policyVersion,
    webhookRequestId: input.webhookRequestId,
    ...(plan && { plan }),
    ...(decision && { decision }),
  };
  call.audits.push(entry);
  return entry;
}
export function executeTool(
  call: GatewayCall,
  input: Invocation,
  policyDecide: DecidePlan = decidePlan,
): ToolResult {
  const decide = withApproval(policyDecide);
  if (input.tool === "verify_identity_result") {
    call.identityConfirmed = input.result === "confirmed";
    if (input.result === "wrong_person") call.status = "human_requested";
    audit(call, input, "RECORDED", ["IDENTITY_RESULT"]);
    return {
      kind: "RECORDED",
      can_confirm: false,
      speak: "Identity result recorded.",
    };
  }
  const stops = {
    mark_dispute: [
      "disputed",
      "I have recorded the dispute and paused collection. A human will review it.",
    ],
    record_opt_out: [
      "opted_out",
      "I have recorded your opt-out and will stop collection contact.",
    ],
    request_human: [
      "human_requested",
      "I have requested a human to follow up and paused collection.",
    ],
    report_already_paid: [
      "already_paid",
      "I have paused collection while the payment is checked. This does not mark the invoice paid.",
    ],
  } as const;
  if (
    input.tool === "mark_dispute" ||
    input.tool === "record_opt_out" ||
    input.tool === "request_human" ||
    input.tool === "report_already_paid"
  ) {
    const [status, speak] = stops[input.tool];
    // Opt-out sets opted_out from any status. A human hold stays until that opt-out.
    if (input.tool === "record_opt_out") call.status = "opted_out";
    else if (call.status !== "opted_out" && call.status !== "human_requested") call.status = status;
    call.outbox.push({ type: input.tool });
    // Asking for a human is how the voice agent handles anything it does not recognize: escalate.
    audit(call, input, input.tool === "request_human" ? "ESCALATE" : "RECORDED", [input.tool.toUpperCase()]);
    return { kind: "RECORDED", can_confirm: false, speak };
  }
  if (!call.identityConfirmed)
    return deny(
      "IDENTITY_REQUIRED",
      "Please confirm I am speaking with the intended contact first.",
    );
  if (input.tool === "get_invoice_context")
    return {
      kind: "CONTEXT",
      can_confirm: false,
      speak: "Identity confirmed; invoice details are available.",
      invoice_id: call.invoiceId,
      amount_cents: call.amountCents,
      currency: call.currency,
    };
  if (call.status !== "active")
    return deny(
      "CALL_STOPPED",
      "I have paused collection on this call. A human will follow up.",
    );
  if (input.tool === "check_approval") {
    const escalation = call.escalations.find(
      (e) => e.id === input.escalationId,
    );
    if (!escalation)
      return deny(
        "ESCALATION_NOT_FOUND",
        "I cannot find that approval request.",
      );
    if (escalation.status === "expired" || escalation.status === "pending_owner") return closedApproval(call, escalation);
    const status =
      escalation.status === "pending" || escalation.method !== "passkey"
        ? "pending"
        : escalation.status;
    const decision = escalation.method === "passkey" ? escalation.decision : undefined;
    if (status === "approved" && escalation.plan) {
      const allowed = decide(call, escalation.plan);
      if (allowed.kind === "ALLOW")
        return { ...authorizePlan(call, input, escalation.plan, allowed), approval_status: status, decision };
    }
    return {
      kind: status === "pending" ? "PENDING" : "RECORDED",
      decision,
      counter_terms: escalation.decision?.kind === "Counter" ? escalation.decision.terms : undefined,
      can_confirm: false,
      approval_status: status,
      speak:
        status === "pending"
          ? "I am still waiting for Dana."
          : status === "denied"
            ? "Dana did not approve those terms."
            : status === "counter"
              ? "Dana offered different terms. Offer the caller exactly these counter terms. If they accept, call propose_plan with those exact terms."
              : "Dana approved the request, but I cannot confirm those terms on this call. A human will follow up.",
    };
  }
  if (input.tool === "send_payment_link") {
    const plan = call.plans.find((p) => p.id === input.planId);
    const entry =
      plan &&
      call.audits.find(
        (a) =>
          a.id === plan.auditId &&
          a.kind === "ALLOW" &&
          (a.action === "propose_plan" || a.action === "check_approval") &&
          a.policyVersion === call.policyVersion,
      );
    if (!plan || !entry || !entry.plan || !sameTerms(plan, entry.plan))
      return deny(
        "ALLOW_REQUIRED",
        "I need an authorized plan before creating a payment link.",
      );
    const decision = decide(call, plan, plan.firstPaymentCents);
    if (decision.kind !== "ALLOW") {
      if (decision.kind === "ESCALATE") {
        const blocked = repeatEscalation(call, plan);
        if (blocked) {
          const checked = audit(call, input, "DENY", [blocked.rule], plan, decision);
          return { ...deny(blocked.rule, blocked.speak), audit_id: checked.id };
        }
      }
      const checked = audit(
        call,
        input,
        decision.kind,
        decision.ruleIds,
        plan,
        decision,
      );
      if (decision.kind === "ESCALATE") {
        const escalation = {
          id: randomUUID(),
          status: "pending" as const,
          toHuman: decision.toHuman,
          ruleIds: decision.ruleIds,
          plan,
        };
        call.escalations.push(escalation);
        return {
          kind: "ESCALATE",
          can_confirm: false,
          speak: decision.reason,
          rule_ids: decision.ruleIds,
          audit_id: checked.id,
          escalation_id: escalation.id,
        };
      }
      return {
        ...deny(decision.ruleIds[0] ?? "INVALID_INPUT", decision.reason),
        rule_ids: decision.ruleIds,
        audit_id: checked.id,
      };
    }
    const existing = call.links.find((link) => link.planId === plan.id);
    if (existing?.expiresAt !== undefined && Date.now() >= existing.expiresAt)
      return deny("PAYMENT_LINK_EXPIRED", "That payment code has expired. Please check a new plan before creating another link.");
    const link = existing ?? {
      id: randomUUID(),
      planId: plan.id,
      auditId: entry.id,
      amountCents: plan.firstPaymentCents,
      path: "",
      shortCode: randomBytes(5).toString("hex").toUpperCase(),
      createdAt: Date.now(),
      expiresAt: Date.now() + 15 * 60_000,
    };
    if (!existing) {
      link.path = `/pay/${link.id}`;
      call.links.push(link);
      call.outbox.push({ type: "send_payment_link", linkId: link.id });
      audit(call, input, "ALLOW", decision.ruleIds, plan, decision);
    }
    return {
      kind: "RECORDED",
      can_confirm: false,
      speak: "The payment link is queued for delivery.",
      link_path: link.path,
      amount_cents: link.amountCents,
      short_code: link.shortCode,
      expires_at: link.expiresAt,
    };
  }
  if (input.tool === "propose_plan") {
    const decision = decide(call, input.plan);
    if (decision.kind === "ESCALATE") {
      const blocked = repeatEscalation(call, input.plan);
      if (blocked) {
        const refused = audit(call, input, "DENY", [blocked.rule], input.plan, decision);
        return { ...deny(blocked.rule, blocked.speak), audit_id: refused.id };
      }
    }
    if (decision.kind === "ALLOW") return authorizePlan(call, input, input.plan, decision);
    const entry = audit(
      call,
      input,
      decision.kind,
      decision.ruleIds,
      input.plan,
      decision,
    );
    if (decision.kind === "ESCALATE") {
      const escalation = {
        id: randomUUID(),
        status: "pending" as const,
        toHuman: decision.toHuman,
        ruleIds: decision.ruleIds,
        plan: input.plan,
      };
      call.escalations.push(escalation);
      return {
        kind: "ESCALATE",
        can_confirm: false,
        speak:
          "I need to check those terms with Dana. Please hold while I ask.",
        escalation_id: escalation.id,
        rule_ids: decision.ruleIds,
        audit_id: entry.id,
      };
    }
    return {
      ...deny(decision.ruleIds[0] ?? "NOT_IN_BADGE", decision.reason),
      rule_ids: decision.ruleIds,
      audit_id: entry.id,
    };
  }
  return deny("NOT_IN_BADGE", "I cannot confirm those terms.");
}
