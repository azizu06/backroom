import { firstPaymentCents } from '@backroom/policy';

/** One code-computed installment of an authorized plan. `dueDate` is a UTC calendar day (YYYY-MM-DD). */
export interface PlanInstallment { installment: number; amountCents: number; dueDate: string }
/** The authorized plan as persisted with its ALLOW audit row. Read-only: it moves no money. */
export interface PaymentPlanRecord {
  planId: string; invoiceId: string; totalCents: number; installments: number; firstPaymentPct: number;
  durationDays: number; authorizedAt: number; schedule: PlanInstallment[];
}
export type InstallmentStatus = 'paid' | 'upcoming';
export interface PlanBalance {
  totalCents: number; paidCents: number; remainingCents: number;
  schedule: (PlanInstallment & { status: InstallmentStatus })[];
}
/** An exact reconciled payment against one installment, from a reducer receipt or its EXACT_PAYMENT_MATCH audit. */
export interface InstallmentPayment { installment: number; amountCents: number }

const DAY_MS = 86_400_000;
const whole = (value: unknown, min: number): value is number => Number.isSafeInteger(value) && (value as number) >= min;

/**
 * NF-027 / #318 schedule. Installment 1 is the policy's first payment (rounded up to a whole dollar); the
 * later installments are equal whole-dollar amounts and the last absorbs the remainder, so the amounts
 * always sum to the total. Due dates spread evenly from the authorization day to the last plan day.
 */
export function paymentSchedule(input: { totalCents: number; firstPaymentPct: number; installments: number;
  durationDays: number; startAt: number }): PlanInstallment[] {
  const { totalCents, firstPaymentPct, installments, durationDays, startAt } = input;
  if (!whole(totalCents, 1) || !whole(installments, 1) || !whole(durationDays, 0) || !Number.isFinite(firstPaymentPct)
    || !Number.isFinite(startAt)) throw new Error('INVALID_PLAN');
  const first = firstPaymentCents(totalCents, firstPaymentPct, installments);
  const later = installments - 1;
  const rest = totalCents - first;
  const each = later ? Math.floor(rest / later / 100) * 100 : 0;
  const day0 = Math.floor(startAt / DAY_MS) * DAY_MS;
  return Array.from({ length: installments }, (_, index) => ({
    installment: index + 1,
    amountCents: index === 0 ? first : index === later ? rest - each * (later - 1) : each,
    dueDate: new Date(day0 + Math.round(index * durationDays / Math.max(later, 1)) * DAY_MS).toISOString().slice(0, 10),
  }));
}

/** Paid is the sum of exact reconciled payments only; an installment is paid only when its receipt exists. */
export function planBalance(totalCents: number, schedule: readonly PlanInstallment[], payments: readonly InstallmentPayment[]): PlanBalance {
  const paid = new Map(payments.map(row => [row.installment, row.amountCents]));
  const paidCents = [...paid.values()].reduce((sum, cents) => sum + cents, 0);
  return { totalCents, paidCents, remainingCents: Math.max(0, totalCents - paidCents),
    schedule: schedule.map(row => ({ ...row, status: paid.has(row.installment) ? 'paid' : 'upcoming' })) };
}

/** Accepts a persisted plan only when its schedule is exactly the code-computed one. */
export function parsePaymentPlan(value: unknown): PaymentPlanRecord | undefined {
  if (!value || typeof value !== 'object') return;
  const plan = value as Partial<PaymentPlanRecord>;
  if (typeof plan.planId !== 'string' || typeof plan.invoiceId !== 'string' || !Array.isArray(plan.schedule)) return;
  try {
    const expected = paymentSchedule({ totalCents: plan.totalCents!, firstPaymentPct: plan.firstPaymentPct!,
      installments: plan.installments!, durationDays: plan.durationDays!, startAt: plan.authorizedAt! });
    // Field by field: the audit chain may store canonical (key-sorted) JSON.
    const same = (row: unknown, want: PlanInstallment) => !!row && typeof row === 'object'
      && (Object.keys(want) as (keyof PlanInstallment)[]).every(key => (row as PlanInstallment)[key] === want[key]);
    if (plan.schedule.length !== expected.length || !expected.every((want, index) => same(plan.schedule![index], want))) return;
    return { planId: plan.planId, invoiceId: plan.invoiceId, totalCents: plan.totalCents!, installments: plan.installments!,
      firstPaymentPct: plan.firstPaymentPct!, durationDays: plan.durationDays!, authorizedAt: plan.authorizedAt!, schedule: expected };
  } catch { return; }
}

const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
/** "Paid $495.00 of $4,950.00 · Remaining $4,455.00" */
export const balanceLine = (balance: Pick<PlanBalance, 'totalCents' | 'paidCents' | 'remainingCents'>) =>
  `Paid ${usd(balance.paidCents)} of ${usd(balance.totalCents)} · Remaining ${usd(balance.remainingCents)}`;
