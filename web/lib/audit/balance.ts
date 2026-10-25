import type { AuditEntry } from '@backroom/orchestrator';
import { parsePaymentPlan, planBalance, type PlanBalance } from '@backroom/orchestrator/payment-schedule';

export type CaseBalance = PlanBalance & { invoiceId: string; planAuditId: string };

const cents = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined;
const planRow = (entry: AuditEntry) => entry.decision === 'ALLOW' && entry.inputs?.paymentPlan !== undefined;

/**
 * Read-only balance of one authorized plan, from the audit chain alone: the plan's ALLOW row carries the
 * code-computed schedule, and each exact reconcile row cites that ALLOW row as its third ref.
 */
export function caseBalance(entries: readonly AuditEntry[], planAuditId: string): CaseBalance | undefined {
  const row = entries.find(entry => entry.id === planAuditId && planRow(entry));
  const plan = row && parsePaymentPlan(row.inputs?.paymentPlan);
  if (!plan) return;
  const payments = entries.filter(entry => entry.action === 'reconcile' && entry.ruleIds.includes('EXACT_PAYMENT_MATCH')
    && entry.refs[0] === plan.invoiceId && entry.refs[2] === planAuditId)
    .flatMap((entry, index) => {
      const amountCents = cents(entry.inputs?.amountCents);
      return amountCents ? [{ installment: cents(entry.inputs?.installment) ?? index + 1, amountCents }] : [];
    });
  return { ...planBalance(plan.totalCents, plan.schedule, payments), invoiceId: plan.invoiceId, planAuditId };
}

/** The most recently authorized plan's balance in these entries. */
export function latestCaseBalance(entries: readonly AuditEntry[]): CaseBalance | undefined {
  const row = entries.findLast(planRow);
  return row && caseBalance(entries, row.id);
}
