import { evaluate, type Context } from '@backroom/policy';
import type { CallPlan } from './types';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** No model strings survive; the policy evaluator validates every numeric term. */
export function validateCallPlan(value: unknown, context: Context): CallPlan | undefined {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'offerOrder,plan,tone'
    || !['neutral', 'empathetic'].includes(value.tone as string)
    || !Array.isArray(value.offerOrder) || value.offerOrder.length < 1 || value.offerOrder.length > 2
    || new Set(value.offerOrder).size !== value.offerOrder.length
    || !value.offerOrder.every(option => option === 'pay_in_full' || option === 'installments')
    || !record(value.plan) || Object.keys(value.plan).sort().join(',') !== 'discountPct,firstPaymentPct,installments,totalDays,waiveFees') return;
  const candidate = value as unknown as CallPlan;
  // This is internal planning validation, never an identity write or speech permission.
  const decision = evaluate('collections', { type: 'propose_plan', plan: candidate.plan }, { ...context, identityConfirmed: true });
  if (decision.kind !== 'ALLOW' || (candidate.offerOrder.includes('installments') && candidate.plan.installments === 1)
    || (!candidate.offerOrder.includes('installments') && candidate.plan.installments > 1)) return;
  return structuredClone(candidate);
}

export function renderCallPlan(plan: CallPlan): string {
  const p = plan.plan;
  const installments = `${p.installments} payments, ${p.firstPaymentPct}% first, over ${p.totalDays} days, ${p.discountPct}% discount, fees ${p.waiveFees ? 'waived' : 'retained'}`;
  return `Use a ${plan.tone} tone. Give the fixed AI/business/recording disclosure; confirm identity before any invoice details. `
    + `Offer ${plan.offerOrder.map(option => option === 'pay_in_full' ? 'payment in full' : installments).join('; then ')}. `
    + 'Escalate exceptions to the controller; give the callback number and honor opt-out. No voice approvals.';
}
