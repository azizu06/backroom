import { evaluate, type Badge, type Decision } from '@backroom/policy';
import type { EffectKind, Step } from './store';

export type PolicyEvaluator = (badge: Badge, step: Step) => Decision;
const effectActions: Record<EffectKind, string> = {
  dial: 'call_client', crs: 'run_crs', apify: 'run_apify', nessie: 'pay_invoice',
};
/** The sole policy-package compatibility seam; default remains fail-closed while stubbed.
 * Bind action to the effect and evaluate its actual input, never a cheaper proposed amount.
 */
export const evaluateStep: PolicyEvaluator = (badge, step) => {
  const type = effectActions[step.kind];
  if (step.action.type !== type) return { kind: 'DENY', reason: 'NOT_IN_BADGE',
    ruleIds: ['NOT_IN_BADGE'], policyVersion: step.context.policyVersion };
  return evaluate(badge, { ...step.action, ...step.input, type }, step.context);
};
