import {
  evaluate,
  type Action,
  type Context,
  type Decision,
} from "../../../policy/src/index";
import type { GatewayCall, PlanTerms } from "./store";

export type DecidePlan = (call: GatewayCall, plan: PlanTerms) => Decision;
/** Only this adapter knows the policy package's action/context vocabulary.
 * Until #11 replaces its deny-all stub, production safely denies proposals.
 */
export const decidePlan: DecidePlan = (call, plan) => {
  const action: Action = { type: "propose_plan", ...plan };
  const context: Context = {
    policyVersion: call.policyVersion,
    invoiceId: call.invoiceId,
    amountCents: call.amountCents,
  };
  return evaluate("collections", action, context);
};
