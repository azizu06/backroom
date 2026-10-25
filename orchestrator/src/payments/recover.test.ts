import { expect, it, vi } from 'vitest';
import { FakeDemoBank } from '../core-demo/bank';
import { MemoryStateStore } from '../store';
import { PaymentService, paymentLinkMemo, type AuthorizedPaymentLink, type BankEvidence } from './index';

const link: AuthorizedPaymentLink = { id: 'link-1042', invoiceId: '1042', planId: 'plan-1042', auditId: 'allow-1042',
  policyVersion: 1, installment: 1, amountCents: 247500, totalCents: 495000, currency: 'USD' };
function setup(links = [link]) {
  const bank = new FakeDemoBank();
  const deposit = vi.spyOn(bank, 'deposit');
  const feed = vi.spyOn(bank, 'listDeposits');
  const lookup = vi.fn(async (id: string) => links.find(row => row.id === id));
  const restart = (onPosted?: (id: string) => Promise<void>) => new PaymentService({ bank, accountId: 'mock', lookup, onPosted });
  return { bank, deposit, feed, lookup, restart, service: restart() };
}
async function job() {
  const store = new MemoryStateStore(); const now = Date.now();
  await store.registerAgent('bookkeeper', 'collections', now);
  await store.enqueueTask({ id: 'reconcile-1042', seatId: 'collections', refs: ['1042'], idempotencyKey: 'ar:1042:1', steps: [] });
  await store.insertInvoice({ id: '1042', kind: 'ar', state: 'promised' });
  return { store, lease: (await store.claimTask('bookkeeper', now, 12000))! };
}

it('recovers a posted payment after restart and retries reconciliation without depositing again', async () => {
  const { service, restart, deposit } = setup(); const { store, lease } = await job();
  const posted = await service.pay(link.id);
  const onPosted = vi.fn(async (id: string) => { await recovered.reconcile(id, store, lease, 'promised'); });
  const recovered = restart(onPosted);
  const transition = vi.spyOn(store, 'transitionInvoice'); const receipt = vi.spyOn(store, 'recordPayment');
  expect(await recovered.recover([link.id], store)).toEqual({ restored: [posted], skipped: [] });
  expect(onPosted).not.toHaveBeenCalled(); expect(transition).not.toHaveBeenCalled(); expect(receipt).not.toHaveBeenCalled();
  expect(await store.getPayment('ar:1042:1')).toBeUndefined();
  expect(await recovered.retryPending()).toEqual([{ linkId: link.id, ok: true }]);
  expect((await recovered.view(link.id)).payment).toEqual({ ...posted, status: 'partially_paid' });
  expect(await store.getPayment('ar:1042:1')).toMatchObject({ result: { invoiceState: 'partially_paid' } });
  expect(deposit).toHaveBeenCalledTimes(1);
});

it.each(['partially_paid', 'paid'] as const)('restores a reconciled %s receipt without retrying or writing', async status => {
  const authorized = { ...link, totalCents: status === 'paid' ? link.amountCents : link.totalCents };
  const { service, restart, deposit } = setup([authorized]); const { store, lease } = await job();
  await service.pay(link.id);
  const reconciled = await service.reconcile(link.id, store, lease, 'promised');
  const transition = vi.spyOn(store, 'transitionInvoice'); const receipt = vi.spyOn(store, 'recordPayment');
  const reserve = vi.spyOn(store, 'reservePayment'); const audit = vi.spyOn(store, 'appendAudit');
  const onPosted = vi.fn(); const recovered = restart(onPosted);
  const result = await recovered.recover([link.id], store);
  expect(result).toEqual({ restored: [reconciled], skipped: [] });
  result.restored[0]!.status = 'exception';
  expect((await recovered.view(link.id)).payment).toEqual(reconciled);
  expect(await recovered.retryPending()).toEqual([]); expect(onPosted).not.toHaveBeenCalled();
  expect(transition).not.toHaveBeenCalled(); expect(receipt).not.toHaveBeenCalled();
  expect(reserve).not.toHaveBeenCalled(); expect(audit).not.toHaveBeenCalled();
  expect(deposit).toHaveBeenCalledTimes(1);
});

it('skips unpaid, unknown, invalid and tracked links in order without overwriting records', async () => {
  const unpaid = { ...link, id: 'unpaid', invoiceId: '1043' };
  const invalid = { ...link, id: 'invalid', auditId: '' };
  const { service, restart, feed, lookup, deposit } = setup([link, unpaid, invalid]);
  const posted = await service.pay(link.id); const recovered = restart(); const store = new MemoryStateStore();
  await recovered.recover([link.id], store);
  feed.mockResolvedValue([]); lookup.mockClear(); deposit.mockClear();
  expect(await recovered.recover([unpaid.id, 'unknown', invalid.id, link.id], store)).toEqual({ restored: [], skipped: [
    { linkId: unpaid.id, reason: 'NOT_POSTED' }, { linkId: 'unknown', reason: 'PAYMENT_LINK_NOT_FOUND' },
    { linkId: invalid.id, reason: 'ALLOW_REQUIRED' }, { linkId: link.id, reason: 'ALREADY_TRACKED' },
  ] });
  expect(lookup.mock.calls.map(([id]) => id)).toEqual([unpaid.id, 'unknown', invalid.id]);
  expect(recovered.pendingPayments()).toEqual([posted]); expect(deposit).not.toHaveBeenCalled();
});

it('skips a receipt whose fingerprint conflicts with the exact bank deposit', async () => {
  const { bank, service, restart, feed, deposit } = setup(); const { store, lease } = await job();
  await service.pay(link.id); await service.reconcile(link.id, store, lease, 'promised');
  const deposits = await bank.listDeposits('mock');
  feed.mockResolvedValue(deposits.map(row => ({ ...row, _id: 'different-deposit' })));
  deposit.mockClear(); const recovered = restart();
  expect(await recovered.recover([link.id], store)).toEqual({ restored: [], skipped: [
    { linkId: link.id, reason: 'RECON_RECEIPT_CONFLICT' },
  ] });
  expect((await recovered.view(link.id)).payment).toBeUndefined();
  expect(recovered.exceptions()).toEqual([]); expect(deposit).not.toHaveBeenCalled();
});

it('reads one feed for multiple links, preserves order and never deposits', async () => {
  const other = { ...link, id: 'link-1043', invoiceId: '1043' };
  const { service, restart, feed, deposit } = setup([link, other]);
  const first = await service.pay(link.id); const second = await service.pay(other.id);
  feed.mockClear(); deposit.mockClear(); const recovered = restart();
  expect(await recovered.recover([other.id, link.id, other.id], new MemoryStateStore())).toEqual({
    restored: [second, first], skipped: [{ linkId: other.id, reason: 'ALREADY_TRACKED' }],
  });
  expect(feed).toHaveBeenCalledExactlyOnceWith('mock'); expect(deposit).not.toHaveBeenCalled();
});

it('rejects a failed bank feed without restoring anything and allows a later recovery', async () => {
  const { service, restart, feed, deposit } = setup(); const store = new MemoryStateStore();
  const posted = await service.pay(link.id); const recovered = restart(); deposit.mockClear();
  feed.mockRejectedValueOnce(new Error('bank unavailable'));
  await expect(recovered.recover([link.id], store)).rejects.toThrow('bank unavailable');
  expect((await recovered.view(link.id)).payment).toBeUndefined(); expect(recovered.pendingPayments()).toEqual([]);
  expect(await recovered.recover([link.id], store)).toEqual({ restored: [posted], skipped: [] });
  expect(deposit).not.toHaveBeenCalled();
});

it.each(['RECON_SHORT', 'RECON_DUPLICATE', 'RECON_FUZZY', 'RECON_MISMATCH'])(
  'keeps %s evidence out of memory without creating exceptions', async ruleId => {
    const { restart, feed, deposit } = setup(); const recovered = restart();
    const row: BankEvidence = { _id: 'deposit', amount: link.amountCents / 100, description: paymentLinkMemo(link),
      status: 'completed', medium: 'balance', transaction_date: '2026-10-24' };
    if (ruleId === 'RECON_SHORT') row.amount -= 1;
    if (ruleId === 'RECON_FUZZY') { row.description = 'untrusted memo'; row.paymentLinkRef = link.id; }
    if (ruleId === 'RECON_MISMATCH') row.medium = 'cash';
    feed.mockResolvedValue(ruleId === 'RECON_DUPLICATE' ? [row, { ...row, _id: 'duplicate' }] : [row]);
    const getPayment = vi.fn();
    expect(await recovered.recover([link.id], { getPayment })).toEqual({ restored: [], skipped: [{ linkId: link.id, reason: ruleId }] });
    expect(recovered.pendingPayments()).toEqual([]); expect(recovered.exceptions()).toEqual([]);
    expect(getPayment).not.toHaveBeenCalled(); expect(deposit).not.toHaveBeenCalled();
  },
);

it('serializes recovery with pay so concurrent calls cannot overwrite restored evidence', async () => {
  const { bank, service, restart, feed, deposit } = setup(); const store = new MemoryStateStore();
  const posted = await service.pay(link.id); const deposits = await bank.listDeposits('mock');
  let release!: (value: typeof deposits) => void;
  feed.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  deposit.mockClear(); const recovered = restart();
  const recovery = recovered.recover([link.id], store); const payment = recovered.pay(link.id);
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  expect(deposit).not.toHaveBeenCalled(); release(deposits);
  expect(await recovery).toEqual({ restored: [posted], skipped: [] });
  expect(await payment).toEqual(posted); expect(deposit).not.toHaveBeenCalled();
});
