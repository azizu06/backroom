import { describe, expect, it } from "vitest";
import { executeTool } from "./service";
import type { Invocation } from "./parser";
import type { GatewayCall, PlanTerms, ToolResult } from "./store";

const call = (): GatewayCall => ({
  callId: "call-1", invoiceId: "1042", clientId: "client-1", contactName: "Jordan", companyName: "Northfield",
  amountCents: 495000, receivable: { principalCents: 480000, lateFeeCents: 15000 }, currency: "USD",
  policyVersion: 1, identityConfirmed: true, status: "active",
  audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {},
});
const seven: PlanTerms = { installments: 7, firstPaymentPct: 15, durationDays: 30, waiveFee: false, discountPct: 0 };
let seq = 0;
const run = (c: GatewayCall, input: Record<string, unknown>) =>
  executeTool(c, { callId: c.callId, webhookRequestId: `w${++seq}`, ...input } as Invocation);
const propose = (c: GatewayCall, plan: PlanTerms) => run(c, { tool: "propose_plan", plan });
const check = (c: GatewayCall, id: unknown) => run(c, { tool: "check_approval", escalationId: id });
const link = (c: GatewayCall, planId: unknown) => run(c, { tool: "send_payment_link", planId });
/** What the trusted approval bridge copies from the StateStore after Dana's passkey decision. */
function decide(c: GatewayCall, id: unknown, decision: NonNullable<GatewayCall["escalations"][number]["decision"]>) {
  const row = c.escalations.find(e => e.id === id)!;
  row.status = decision.kind === "Approve" ? "approved" : decision.kind === "Deny" ? "denied" : "counter";
  row.method = "passkey";
  row.decision = decision;
}
const escalated = (c: GatewayCall, plan = seven) => {
  const result = propose(c, plan);
  expect(result).toMatchObject({ kind: "ESCALATE", can_confirm: false, rule_ids: ["MAX_INSTALLMENTS"] });
  return result.escalation_id;
};
const expectAllowed = (result: ToolResult, plan: PlanTerms) => {
  expect(result).toMatchObject({ kind: "ALLOW", can_confirm: true, rule_ids: ["MAX_INSTALLMENTS", "DANA_APPROVED"], plan });
  expect(result.plan_id).toEqual(expect.any(String));
  expect(result.speak).toMatch(/payment link/);
};

describe("Dana's passkey decision unlocks exactly the terms she authorized", () => {
  it("check_approval on an approved escalation returns the authorized plan, and the link is code-computed", () => {
    const c = call();
    const id = escalated(c);
    decide(c, id, { kind: "Approve" });
    const approved = check(c, id);
    expectAllowed(approved, seven);
    expect(approved).toMatchObject({ approval_status: "approved", decision: { kind: "Approve" } });
    const audit = c.audits.find(a => a.id === approved.audit_id)!;
    expect(audit).toMatchObject({ kind: "ALLOW", ruleIds: ["MAX_INSTALLMENTS", "DANA_APPROVED"], plan: seven,
      decision: { kind: "ALLOW", escalationId: id } });
    const sent = link(c, approved.plan_id);
    // NF-027: 15% of principal + late fee is $742.50, rounded up by code to a whole dollar the sandbox bank accepts.
    expect(approved).toMatchObject({ plan: { totalCents: 495000, firstPaymentCents: 74300 } });
    expect(approved.speak).toContain("$743.00");
    expect(sent).toMatchObject({ kind: "RECORDED", amount_cents: 74300 });
    expect(sent.speak).toContain("$743.00");
    expect(c.outbox).toEqual([{ type: "send_payment_link", linkId: c.links[0]!.id }]);
    expect(c.escalations).toHaveLength(1);
  });

  it("propose_plan with the same exact terms after approval is ALLOW and sends the link without a new escalation", () => {
    const c = call();
    const id = escalated(c);
    decide(c, id, { kind: "Approve" });
    const allowed = propose(c, seven);
    expectAllowed(allowed, seven);
    expect(link(c, allowed.plan_id)).toMatchObject({ kind: "RECORDED", amount_cents: 74300 });
    expect(c.escalations).toHaveLength(1);
  });

  it("different terms after an approval still escalate", () => {
    const c = call();
    const id = escalated(c);
    decide(c, id, { kind: "Approve" });
    expect(propose(c, { ...seven, installments: 8 })).toMatchObject({ kind: "ESCALATE", can_confirm: false, rule_ids: ["MAX_INSTALLMENTS"] });
    expect(c.escalations).toHaveLength(2);
  });

  it("a counter authorizes the counter terms once the caller accepts them, not the original request", () => {
    const c = call();
    const id = escalated(c);
    const counter = { ...seven, installments: 5, firstPaymentPct: 25 };
    decide(c, id, { kind: "Counter", terms: counter });
    expect(check(c, id)).toMatchObject({ kind: "RECORDED", can_confirm: false, approval_status: "counter", counter_terms: counter });
    expect(propose(c, seven)).toMatchObject({ kind: "ESCALATE", can_confirm: false });
    const accepted = propose(c, counter);
    expectAllowed(accepted, counter);
    expect(link(c, accepted.plan_id)).toMatchObject({ kind: "RECORDED", amount_cents: 123800 });
  });

  it("never turns a policy DENY into ALLOW, and a Deny or an unverified approval authorizes nothing", () => {
    const c = call();
    const waived = { ...seven, waiveFee: true };
    c.escalations.push({ id: "signed", status: "approved", method: "passkey", decision: { kind: "Approve" },
      ruleIds: ["MAX_INSTALLMENTS"], toHuman: "Dana", plan: waived });
    expect(propose(c, waived)).toMatchObject({ kind: "DENY", can_confirm: false, rule_ids: ["FEES_NON_WAIVABLE"] });
    expect(check(c, "signed")).toMatchObject({ can_confirm: false, approval_status: "approved" });
    const u = call();
    u.escalations.push({ id: "voice", status: "approved", decision: { kind: "Approve" }, ruleIds: ["MAX_INSTALLMENTS"],
      toHuman: "Dana", plan: seven });
    expect(propose(u, seven)).toMatchObject({ kind: "ESCALATE", can_confirm: false });
    expect(check(u, "voice")).toMatchObject({ kind: "PENDING", can_confirm: false });
    const d = call();
    const id = escalated(d);
    decide(d, id, { kind: "Deny" });
    expect(check(d, id)).toMatchObject({ kind: "RECORDED", can_confirm: false, approval_status: "denied" });
    expect(propose(d, seven)).toMatchObject({ kind: "ESCALATE", can_confirm: false });
  });

  it("a fresh stop signal still blocks the approved plan's link", () => {
    const c = call();
    const id = escalated(c);
    decide(c, id, { kind: "Approve" });
    const approved = check(c, id);
    c.policyState = { signals: { bankruptcy: true } };
    expect(link(c, approved.plan_id)).toMatchObject({ kind: "ESCALATE", can_confirm: false, rule_ids: ["BANKRUPTCY_STOP"] });
    expect(c.links).toHaveLength(0);
  });
});
