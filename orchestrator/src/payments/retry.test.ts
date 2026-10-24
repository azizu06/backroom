import { expect, it, vi } from 'vitest';
import type { BalanceDisplay } from '@backroom/nessie';
import { FakeDemoBank } from '../core-demo/bank';
import { MemoryStateStore } from '../store';
import { PaymentService, type AuthorizedPaymentLink, type PaymentBank } from './index';

const link: AuthorizedPaymentLink = { id: 'link-1042', invoiceId: '1042', planId: 'plan-1042', auditId: 'allow-1042',
  policyVersion: 1, installment: 1, amountCents: 247500, totalCents: 495000, currency: 'USD' };
function setup(onPosted?: (linkId: string) => Promise<void>, links = [link]) {
  const bank = new FakeDemoBank(); const deposit = vi.spyOn(bank, 'deposit');
  const service = new PaymentService({ bank, accountId: 'mock', lookup: async id => links.find(row => row.id === id), onPosted });
  return { bank, deposit, service };
}
async function job() {
  const store = new MemoryStateStore(); const now = Date.now();
  await store.registerAgent('bookkeeper', 'collections', now);
  await store.enqueueTask({ id: 'reconcile-1042', seatId: 'collections', refs: ['1042'], idempotencyKey: 'ar:1042:1', steps: [] });
  await store.insertInvoice({ id: '1042', kind: 'ar', state: 'promised' });
  return { store, lease: (await store.claimTask('bookkeeper', now, 12000))! };
}

it.each(['partially_paid', 'paid'] as const)('retries a failed hook and reconciles to %s without another deposit', async status => {
  const onPosted = vi.fn(async (_id: string): Promise<void> => { throw new Error('LEASE_BUSY'); });
  const authorized = { ...link, totalCents: status === 'paid' ? link.amountCents : link.totalCents };
  const { service, deposit } = setup(onPosted, [authorized]); const { store, lease } = await job();
  expect(await service.pay(link.id)).toMatchObject({ status: 'pending_reconciliation' });
  expect(service.pendingPayments()).toHaveLength(1);
  onPosted.mockImplementation(async id => { await service.reconcile(id, store, lease, 'promised'); });
  expect(await service.retryPending()).toEqual([{ linkId: link.id, ok: true }]);
  expect(onPosted.mock.calls).toEqual([[link.id], [link.id]]);
  expect((await service.view(link.id)).payment).toMatchObject({ status });
  expect(await service.retryPending()).toEqual([]);
  expect(onPosted).toHaveBeenCalledTimes(2);
  expect(deposit).toHaveBeenCalledTimes(1);
});

it('continues in payment order after a failed retry and only reports hook success', async () => {
  const other = { ...link, id: 'link-1043', invoiceId: '1043' };
  const onPosted = vi.fn(async (_id: string): Promise<void> => { throw new Error('LEASE_BUSY'); });
  const { service, deposit } = setup(onPosted, [link, other]);
  await service.pay(link.id); await service.pay(other.id); onPosted.mockClear();
  onPosted.mockImplementation(async id => { if (id === link.id) throw new Error('LEASE_BUSY'); });
  expect(await service.retryPending()).toEqual([{ linkId: link.id, ok: false }, { linkId: other.id, ok: true }]);
  expect(onPosted.mock.calls).toEqual([[link.id], [other.id]]);
  expect(service.pendingPayments().map(row => row.linkId)).toEqual([link.id, other.id]);
  expect(deposit).toHaveBeenCalledTimes(2);
});

it('returns no retries without a host hook even when a payment is pending', async () => {
  const { service, deposit } = setup();
  await service.pay(link.id);
  expect(await service.retryPending()).toEqual([]);
  expect(service.pendingPayments()).toHaveLength(1);
  expect(deposit).toHaveBeenCalledTimes(1);
});

it('shares the in-flight promise and starts a new sweep after completion', async () => {
  const other = { ...link, id: 'link-1043', invoiceId: '1043' };
  const onPosted = vi.fn(async (_id: string): Promise<void> => { throw new Error('LEASE_BUSY'); });
  const { service, deposit } = setup(onPosted, [link, other]);
  await service.pay(link.id); await service.pay(other.id); onPosted.mockClear();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  onPosted.mockImplementation(async () => { await gate; });
  const first = service.retryPending(); const second = service.retryPending();
  expect(second).toBe(first);
  await Promise.resolve();
  expect(onPosted.mock.calls).toEqual([[link.id]]);
  expect(service.retryPending()).toBe(first);
  release();
  expect(await first).toEqual([{ linkId: link.id, ok: true }, { linkId: other.id, ok: true }]);
  expect(onPosted.mock.calls).toEqual([[link.id], [other.id]]);
  expect(await service.retryPending()).toEqual([{ linkId: link.id, ok: true }, { linkId: other.id, ok: true }]);
  expect(onPosted).toHaveBeenCalledTimes(4);
  expect(deposit).toHaveBeenCalledTimes(2);
});

it('returns cached display metadata while reconciliation still requires the live feed', async () => {
  const { service, bank } = setup(); const { store, lease } = await job();
  await service.pay(link.id);
  const display: BalanceDisplay = { ...await bank.readBalanceWithPostedDeposits('mock'),
    postedDepositIds: ['cached-deposit'], cached: true, observedAt: '2026-10-24T12:00:00.000Z', freshness: 'cached at 12:00 UTC' };
  const readDisplay = vi.spyOn(bank, 'readBalanceDisplay').mockResolvedValue(display);
  const readLegacy = vi.spyOn(bank, 'readBalanceWithPostedDeposits').mockRejectedValue(new Error('outage'));
  vi.spyOn(bank, 'listDeposits').mockRejectedValue(new Error('outage'));
  expect((await service.view(link.id)).balance).toEqual(display);
  expect(readDisplay).toHaveBeenCalledWith('mock'); expect(readLegacy).not.toHaveBeenCalled();
  await expect(service.reconcile(link.id, store, lease, 'promised')).rejects.toThrow('outage');
  expect(service.pendingPayments()).toHaveLength(1);
  expect(await store.getPayment('ar:1042:1')).toBeUndefined();
});

it('keeps the legacy balance read for banks without readBalanceDisplay', async () => {
  const original = new FakeDemoBank();
  const bank: PaymentBank = { deposit: original.deposit.bind(original), listDeposits: original.listDeposits.bind(original),
    readBalanceWithPostedDeposits: vi.fn(original.readBalanceWithPostedDeposits.bind(original)),
    surfaceCopy: original.surfaceCopy.bind(original) };
  const service = new PaymentService({ bank, accountId: 'mock', lookup: async () => link });
  const balance = await original.readBalanceWithPostedDeposits('mock');
  expect((await service.view(link.id)).balance).toEqual(balance);
  expect(bank.readBalanceWithPostedDeposits).toHaveBeenCalledExactlyOnceWith('mock');
});
