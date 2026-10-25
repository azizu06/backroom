import type { AuthorizedPaymentLink } from '@backroom/orchestrator';
import { DANA_APPROVED } from '../gateway/policy-adapter';
import type { AuditEntry, GatewayCall } from '../gateway/store';

/** A plan is authorized by propose_plan's ALLOW, or by check_approval's ALLOW on Dana's passkey approval. */
const isPlanAuthority = (row: AuditEntry) =>
  row.action === 'propose_plan' || (row.action === 'check_approval' && row.ruleIds.includes(DANA_APPROVED));

/** Only stored gateway rows and their original ALLOW audit can authorize a payment. */
export function authorizedPaymentLink(call: GatewayCall, id: string, now = Date.now()): AuthorizedPaymentLink | undefined {
  const link = call.links.find(row => row.id === id);
  const plan = link && call.plans.find(row => row.id === link.planId && row.auditId === link.auditId);
  const audit = plan && call.audits.find(row => row.id === plan.auditId && row.kind === 'ALLOW'
    && isPlanAuthority(row) && row.policyVersion === call.policyVersion);
  if (!link || !plan || !audit?.plan || call.currency !== 'USD' || call.status !== 'active'
    || (link.expiresAt !== undefined && now >= link.expiresAt)) return;
  for (const field of ['installments', 'firstPaymentPct', 'durationDays', 'waiveFee', 'discountPct'] as const) {
    if (audit.plan[field] !== plan[field]) return;
  }
  const total = Math.round(call.receivable.principalCents * (1 - plan.discountPct / 100))
    + (plan.waiveFee ? 0 : call.receivable.lateFeeCents);
  const first = plan.installments === 1 ? total : Math.round(total * plan.firstPaymentPct / 100);
  if (plan.totalCents !== total || plan.firstPaymentCents !== first || link.amountCents !== first) return;
  return { id: link.id, invoiceId: call.invoiceId, planId: plan.id, auditId: audit.id, policyVersion: call.policyVersion,
    installment: 1, amountCents: link.amountCents, totalCents: plan.totalCents, currency: 'USD' };
}
