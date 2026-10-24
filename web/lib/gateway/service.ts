import { randomUUID } from "node:crypto";
import type { Invocation } from "./parser";
import {
  decidePlan,
  type DecidePlan,
  type GatewayPolicyDecision,
} from "./policy-adapter";
import type { AuditEntry, GatewayCall, PlanTerms, ToolResult } from "./store";

const sameTerms = (a: PlanTerms, b: PlanTerms) =>
  a.installments === b.installments &&
  a.firstPaymentPct === b.firstPaymentPct &&
  a.durationDays === b.durationDays &&
  a.waiveFee === b.waiveFee &&
  a.discountPct === b.discountPct;
const deny = (rule: string, speak: string): ToolResult => ({
  kind: "DENY",
  can_confirm: false,
  speak,
  rule_ids: [rule],
});
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
  decide: DecidePlan = decidePlan,
): ToolResult {
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
    // Opt-out is sticky even if a later tool classifies the call differently.
    if (call.status !== "opted_out") call.status = status;
    call.outbox.push({ type: input.tool });
    audit(call, input, "RECORDED", [input.tool.toUpperCase()]);
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
    const status =
      escalation.status === "pending_owner" ? "pending_owner" :
      escalation.status === "pending" || escalation.method !== "passkey"
        ? "pending"
        : escalation.status;
    return {
      kind: status === "pending" ? "PENDING" : "RECORDED",
      decision: escalation.method === "passkey" ? escalation.decision : undefined,
      counter_terms: escalation.decision?.kind === "Counter" ? escalation.decision.terms : undefined,
      can_confirm: false,
      approval_status: status,
      speak:
        status === "pending_owner"
          ? "Dana will confirm by email today."
          : status === "pending"
          ? "I am still waiting for Dana. Dana will confirm by email today if needed."
          : status === "denied"
            ? "Dana did not approve those terms."
            : "Dana has reviewed the request. I must check the exact terms before confirming.",
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
          a.action === "propose_plan" &&
          a.policyVersion === call.policyVersion,
      );
    if (!plan || !entry || !entry.plan || !sameTerms(plan, entry.plan))
      return deny(
        "ALLOW_REQUIRED",
        "I need an authorized plan before creating a payment link.",
      );
    const decision = decide(call, plan, plan.firstPaymentCents);
    if (decision.kind !== "ALLOW") {
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
    const link = existing ?? {
      id: randomUUID(),
      planId: plan.id,
      auditId: entry.id,
      amountCents: plan.firstPaymentCents,
      path: "",
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
    };
  }
  if (input.tool === "propose_plan") {
    const decision = decide(call, input.plan);
    const entry = audit(
      call,
      input,
      decision.kind,
      decision.ruleIds,
      input.plan,
      decision,
    );
    if (decision.kind === "ALLOW") {
      const totalCents =
        Math.round(
          call.receivable.principalCents * (1 - input.plan.discountPct / 100),
        ) + (input.plan.waiveFee ? 0 : call.receivable.lateFeeCents);
      const plan = {
        ...input.plan,
        id: randomUUID(),
        auditId: entry.id,
        totalCents,
        firstPaymentCents:
          input.plan.installments === 1
            ? totalCents
            : Math.round((totalCents * input.plan.firstPaymentPct) / 100),
      };
      call.plans.push(plan);
      return {
        kind: "ALLOW",
        can_confirm: true,
        speak: "Those terms are authorized. You may confirm this exact plan.",
        rule_ids: decision.ruleIds,
        audit_id: entry.id,
        plan_id: plan.id,
        plan,
      };
    }
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
