import { expect, it } from 'vitest';
import seed from '../../../fixtures/company/northfield.json';
import answerKey from '../../../fixtures/answer-key/expected.json';
import { inspectPaymentEvidence, reconcileAlreadyPaid, type BankEvidence } from './index';
import { MemoryStateStore } from '../store';

// Trust only explicit fixture link references. Preserve raw memos: fuzzy evidence cannot clear money.
const feed: BankEvidence[] = seed.bankTransactions.map(row => ({ _id: row.id, amount: row.amountCents / 100,
  description: row.memo, paymentLinkRef: 'paymentLinkRef' in row ? row.paymentLinkRef as string : undefined,
  status: 'completed', medium: 'balance', transaction_date: row.postedAt.slice(0, 10) }));
it('C19 keeps the planted short payment unadvanced with RECON_SHORT and email followup', () => {
  expect(answerKey.collections.C19.case).toBe('short-payment');
  const link = seed.paymentLinks.find(row => row.id === 'link-short-1044')!;
  expect(inspectPaymentEvidence({ linkId: link.id, amountCents: link.amountCents,
    memo: 'backroom:invoice=1044:installment=1' }, feed)).toMatchObject({ ruleId: 'RECON_SHORT', depositIds: ['seed-short-1044'] });
});
it('C20 flags two distinct deposits for the same link as RECON_DUPLICATE', () => {
  expect(answerKey.collections.C20.case).toBe('duplicate-payment');
  const link = seed.paymentLinks.find(row => row.id === 'link-duplicate-1045')!;
  expect(inspectPaymentEvidence({ linkId: link.id, amountCents: link.amountCents,
    memo: 'backroom:invoice=1045:installment=1' }, feed)).toMatchObject({ ruleId: 'RECON_DUPLICATE', depositIds: ['seed-duplicate-a', 'seed-duplicate-b'] });
});
it.each(['1043', '1042'])('already-paid claim for %s clears only the exact trusted remittance', async id => {
  const invoice = seed.arInvoices.find(row => row.id === id)!;
  const store = new MemoryStateStore(); const now = Date.now();
  await store.registerAgent('claim-job', 'collections', now);
  await store.insertInvoice({ id, kind: 'ar', state: 'overdue' });
  await store.enqueueTask({ id: `claim-${id}`, seatId: 'collections', refs: [id], steps: [], idempotencyKey: `ar:${id}:1` });
  const lease = (await store.claimTask('claim-job', now, 12000))!;
  const result = await reconcileAlreadyPaid({ invoiceId: id, totalCents: invoice.principalCents + invoice.lateFeeCents,
    expectedMemo: `Harbor Media payment invoice ${id}`, policyVersion: seed.policyVersion }, feed, store, lease, 'overdue', now);
  if (id === '1043') {
    expect(answerKey.collections.C06.case).toBe('already-paid-matched');
    expect(result).toEqual({ status: 'paid', depositId: 'seed-credit-1043' });
    expect(await store.getPayment('ar:1043:1')).toMatchObject({ result: { invoiceState: 'paid', amountCents: 76000 } });
  } else {
    expect(answerKey.collections.C07.case).toBe('already-paid-unmatched');
    expect(result).toEqual({ status: 'exception', ruleId: 'RECON_UNMATCHED' });
    await expect(store.transitionInvoice(lease, id, 'overdue', 'disputed', now)).resolves.toBeUndefined();
    expect((await store.listAudit()).find(row => row.action === 'reconcile')).toMatchObject({ inputs: { claimRecorded: true, followup: 'controller_review', stateUnchanged: true } });
  }
});
