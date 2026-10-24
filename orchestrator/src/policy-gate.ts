import { evaluate, type Badge, type Decision } from '@backroom/policy';
import type { EffectKind, Step } from './store';

export type PolicyEvaluator = (badge: Badge, step: Step) => Decision;
const effectActions: Record<EffectKind, string> = {
  dial: 'call_client', crs: 'run_crs', apify: 'run_apify', nessie: 'pay_invoice',
};
/** The sole policy-package compatibility seam.
 * Bind action to the effect and evaluate its actual input, never a cheaper proposed amount.
 */
export const evaluateStep: PolicyEvaluator = (badge, step) => {
  const type = effectActions[step.kind];
  if (step.action.type !== type) return evaluate(badge, { type: 'unknown_effect' }, step.context);
  return evaluate(badge, { ...step.action, ...step.input, type }, step.context);
};
