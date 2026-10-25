import { describe, expect, it } from 'vitest';
import { balanceLine, parsePaymentPlan, paymentSchedule, planBalance } from './schedule';

const startAt = Date.UTC(2026, 9, 25, 15, 30);
const sum = (rows: { amountCents: number }[]) => rows.reduce((total, row) => total + row.amountCents, 0);

describe('paymentSchedule', () => {
  it('splits the Dana-approved 8 x 10% / 240 days plan into whole dollars that sum to the total', () => {
    const schedule = paymentSchedule({ totalCents: 495000, firstPaymentPct: 10, installments: 8, durationDays: 240, startAt });
    expect(schedule.map(row => row.amountCents)).toEqual([49500, 63600, 63600, 63600, 63600, 63600, 63600, 63900]);
    expect(sum(schedule)).toBe(495000);
    expect(schedule.every(row => row.amountCents % 100 === 0)).toBe(true);
    expect(schedule.map(row => row.dueDate)).toEqual(['2026-10-25', '2026-11-28', '2027-01-02', '2027-02-05',
      '2027-03-11', '2027-04-14', '2027-05-19', '2027-06-22']);
  });
  it('uses the #318 rounded-up first payment and lets the last installment absorb the remainder', () => {
    const schedule = paymentSchedule({ totalCents: 495000, firstPaymentPct: 15, installments: 7, durationDays: 30, startAt });
    expect(schedule[0]).toEqual({ installment: 1, amountCents: 74300, dueDate: '2026-10-25' });
    expect(schedule.at(-1)).toMatchObject({ installment: 7, dueDate: '2026-11-24' });
    expect(sum(schedule)).toBe(495000);
  });
  it('pays half now and half on the last plan day', () => {
    expect(paymentSchedule({ totalCents: 495000, firstPaymentPct: 50, installments: 2, durationDays: 30, startAt }))
      .toEqual([{ installment: 1, amountCents: 247500, dueDate: '2026-10-25' }, { installment: 2, amountCents: 247500, dueDate: '2026-11-24' }]);
  });
  it('keeps a non-whole-dollar total exact, with the cents on the last installment', () => {
    const schedule = paymentSchedule({ totalCents: 495050, firstPaymentPct: 10, installments: 4, durationDays: 90, startAt });
    expect(sum(schedule)).toBe(495050);
    expect(schedule.slice(0, -1).every(row => row.amountCents % 100 === 0)).toBe(true);
    expect(paymentSchedule({ totalCents: 495050, firstPaymentPct: 100, installments: 1, durationDays: 0, startAt }))
      .toEqual([{ installment: 1, amountCents: 495050, dueDate: '2026-10-25' }]);
  });
  it('rejects malformed terms', () => {
    expect(() => paymentSchedule({ totalCents: 0, firstPaymentPct: 10, installments: 2, durationDays: 30, startAt })).toThrow('INVALID_PLAN');
    expect(() => paymentSchedule({ totalCents: 1000, firstPaymentPct: 10, installments: 0, durationDays: 30, startAt })).toThrow('INVALID_PLAN');
  });
});

describe('planBalance', () => {
  const schedule = paymentSchedule({ totalCents: 495000, firstPaymentPct: 10, installments: 8, durationDays: 240, startAt });
  it('counts only exact reconciled payments as paid', () => {
    const balance = planBalance(495000, schedule, [{ installment: 1, amountCents: 49500 }]);
    expect(balance).toMatchObject({ totalCents: 495000, paidCents: 49500, remainingCents: 445500 });
    expect(balance.schedule.map(row => row.status)).toEqual(['paid', ...Array(7).fill('upcoming')]);
    expect(balanceLine(balance)).toBe('Paid $495.00 of $4,950.00 · Remaining $4,455.00');
    expect(planBalance(495000, schedule, []).remainingCents).toBe(495000);
  });
  it('accepts a persisted plan only when its schedule is the code-computed one', () => {
    const plan = { planId: 'p', invoiceId: '1042', totalCents: 495000, installments: 8, firstPaymentPct: 10, durationDays: 240, authorizedAt: startAt, schedule };
    expect(parsePaymentPlan(structuredClone(plan))).toEqual(plan);
    const tampered = structuredClone(plan); tampered.schedule[1]!.amountCents = 1;
    expect(parsePaymentPlan(tampered)).toBeUndefined();
    expect(parsePaymentPlan({ ...plan, totalCents: 'x' })).toBeUndefined();
    expect(parsePaymentPlan(undefined)).toBeUndefined();
  });
});
