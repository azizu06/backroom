import {
  evaluate,
  type Action,
  type Context,
  type Decision,
  type Plan,
} from "../../../policy/src/index";
import type { GatewayCall, PlanTerms } from "./store";

export type GatewayPolicyState = Pick<Context, "policy" | "signals">;
export type GatewayPolicyDecision = Decision;
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
