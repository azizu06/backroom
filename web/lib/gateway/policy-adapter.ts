import {
  evaluate,
  type Action,
  type Context,
  type Decision,
  type Plan,
  type RuleId,
} from "../../../policy/src/index";
import type { GatewayCall, PlanTerms } from "./store";

export type GatewayPolicyState = Pick<Context, "policy" | "signals">;
/** Gateway-only rule id: Dana's passkey decision authorized these exact terms. Not a policy rule. */
export const DANA_APPROVED = "DANA_APPROVED";
export type ApprovedDecision = {
  kind: "ALLOW";
  ruleIds: (RuleId | typeof DANA_APPROVED)[];
  policyVersion: number;
  escalationId: string;
};
export type GatewayPolicyDecision = Decision | ApprovedDecision;
export type DecidePlan = (
  call: GatewayCall,
  plan: PlanTerms,
  paymentAmountCents?: number,
) => Decision;

/** Only this adapter knows the policy package's action/context vocabulary.
 * All context comes from trusted store state; the HTTP schema cannot set it.
 */
export const decidePlan: DecidePlan = (call, terms, paymentAmountCents) => {
  const plan: Plan = {
    installments: terms.installments,
    firstPaymentPct: terms.firstPaymentPct,
    totalDays: terms.durationDays,
    waiveFees: terms.waiveFee,
    discountPct: terms.discountPct,
  };
  const action: Action =
    paymentAmountCents === undefined
      ? { type: "propose_plan", plan }
      : { type: "send_payment_link", plan, amountCents: paymentAmountCents };
  const context: Context = {
    ...call.policyState,
    policyVersion: call.policyVersion,
    identityConfirmed: call.identityConfirmed,
    receivable: call.receivable,
  };
  return evaluate("collections", action, context);
};
