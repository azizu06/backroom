import { northfield } from '../payables/northfield';
/** Thin structural subset of #21's NessieClient; dollars at its read/feed boundary. */
export interface DemoPayment { accountId: string; invoiceId: string; installment: number; amountCents: number }
export interface DemoDeposit { _id: string; amount: number; description: string; status: string }
export interface DemoBank {
  readBalance(accountId: string): Promise<number>;
  deposit(payment: DemoPayment): Promise<DemoDeposit>;
  listDeposits(accountId: string): Promise<DemoDeposit[]>;
}
export const memo = (p: DemoPayment) => `backroom:invoice=${encodeURIComponent(p.invoiceId)}:installment=${p.installment}`;

/** SIMULATED Nessie. Not a real deposit or evidence for the T4 sponsor gate. */
export class FakeDemoBank implements DemoBank {
  private balance = northfield.bankAccounts.find(row => row.id === 'receivables')!.balanceCents / 100;
  private deposits: DemoDeposit[] = [];
  async readBalance() { return this.balance; }
  async listDeposits() { return structuredClone(this.deposits); }
  async deposit(payment: DemoPayment) {
    const description = memo(payment);
    const existing = this.deposits.find(row => row.description === description);
    if (existing) {
      if (Math.round(existing.amount * 100) !== payment.amountCents) throw new Error('PAYMENT_REFERENCE_CONFLICT');
      return structuredClone(existing);
    }
    if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) throw new Error('INVALID_AMOUNT');
    const row = { _id: `fake-deposit-${this.deposits.length + 1}`, amount: payment.amountCents / 100, description, status: 'completed' };
    this.deposits.push(row); this.balance += row.amount;
    return structuredClone(row);
  }
}

/** Deterministic bookkeeper adapter until #21 reconciliation lands. Never fuzzy-match money. */
export function reconcile(payment: DemoPayment, depositId: string, feed: DemoDeposit[]) {
  const matches = feed.filter(row => row.description === memo(payment));
  return matches.length === 1 && matches[0]!._id === depositId && matches[0]!.status === 'completed'
    && Math.round(matches[0]!.amount * 100) === payment.amountCents ? 'partially_paid' as const : 'exception' as const;
}
