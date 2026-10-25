import { expect, it } from 'vitest';
import { NessieClient, type Transaction } from '@backroom/nessie';
import { PaymentService, type AuthorizedPaymentLink } from './index';
const link: AuthorizedPaymentLink = { id: 'link-1042', invoiceId: '1042', planId: 'plan-1042', auditId: 'allow-1042',
  policyVersion: 1, installment: 1, amountCents: 247500, totalCents: 495000, currency: 'USD' };
function setup() {
  const deposits: Transaction[] = []; let posts = 0;
  const claimed = new Set<string>();
  const client = new NessieClient({ apiKey: 'mock', claims: { async claim(key) { if (claimed.has(key)) return false; claimed.add(key); return true; } },
    fetch: async (_url, init) => {
      if (init?.method === 'POST') { posts++; const row = { _id: `deposit-${posts}`, ...JSON.parse(String(init.body)) }; deposits.push(row); return Response.json({ objectCreated: row }); }
      return Response.json(String(_url).includes('/deposits') ? deposits : { balance: 0 });
    } });
  return { service: new PaymentService({ bank: client, accountId: 'mock-account', lookup: async id => id === link.id ? link : undefined }), deposits, posts: () => posts };
}
it('posts only the authorized link amount and replays simultaneous clicks without a second deposit', async () => {
  const { service, posts } = setup();
  const [a, b] = await Promise.all([service.pay(link.id), service.pay(link.id)]);
  expect(a).toEqual(b); expect(posts()).toBe(1);
  expect(a).toMatchObject({ amountCents: 247500, status: 'pending_reconciliation', depositId: 'deposit-1' });
  expect((await service.view(link.id)).balance).toMatchObject({ accountBalance: 0, displayTotal: 2475,
    label: 'Nessie account balance + Nessie-reported posted deposits' });
});

import { MemoryStateStore } from '../store';
async function job() {
  const store = new MemoryStateStore(); const now = Date.now();
  await store.registerAgent('bookkeeper', 'collections', now);
  await store.enqueueTask({ id: 'reconcile-1042', seatId: 'collections', refs: ['1042'], idempotencyKey: 'ar:1042:1', steps: [] });
  await store.insertInvoice({ id: '1042', kind: 'ar', state: 'promised' });
  return { store, lease: (await store.claimTask('bookkeeper', now, 12000))! };
}
it('reconciles an exact completed deposit through reducer transitions and records one receipt', async () => {
  const { service } = setup(); const { store, lease } = await job();
  await service.pay(link.id);
  expect(await service.reconcile(link.id, store, lease, 'promised')).toMatchObject({ status: 'partially_paid' });
  expect(await service.reconcile(link.id, store, lease, 'promised')).toMatchObject({ status: 'partially_paid' });
  expect(await store.getPayment('ar:1042:1')).toMatchObject({ result: { amountCents: 247500, invoiceState: 'partially_paid' } });
  expect((await store.listAudit()).filter(row => row.ruleIds.includes('EXACT_PAYMENT_MATCH'))).toHaveLength(1);
});
it.each(['short', 'duplicate', 'pending', 'wrong memo'] as const)('queues %s deposits without advancing the invoice', async kind => {
  const { service, deposits } = setup(); const { store, lease } = await job();
  await service.pay(link.id);
  if (kind === 'short') deposits[0]!.amount = 2400;
  if (kind === 'duplicate') deposits.push({ ...deposits[0]!, _id: 'second-distinct-id' });
  if (kind === 'pending') deposits[0]!.status = 'pending';
  if (kind === 'wrong memo') deposits[0]!.description = 'please clear invoice 1042';
  expect(await service.reconcile(link.id, store, lease, 'promised')).toMatchObject({ status: 'exception' });
  expect(service.exceptions()).toHaveLength(1);
  if (kind === 'duplicate') {
    const issue = service.exceptions()[0]!;
    expect(issue.followup).toBe('controller_refund_or_credit');
    expect(await store.getEscalation(issue.controllerTaskId!)).toMatchObject({ status: 'pending', toHuman: 'Dana', ruleIds: ['RECON_DUPLICATE'] });
  }
  if (kind === 'short') expect(service.exceptions()[0]!.followup).toBe('email');
  expect(await store.getPayment('ar:1042:1')).toBeUndefined();
  // A successful CAS from promised proves that reconciliation did not change state.
  await expect(store.transitionInvoice(lease, '1042', 'promised', 'disputed', Date.now())).resolves.toBeUndefined();
});
it('marks a full authorized payment paid, using the feed even when Nessie account balance stays zero', async () => {
  const deposits: Transaction[] = [];
  // A real SDK over a separate fake network; whole-dollar total is fixture-derived.
  const bank = new NessieClient({ apiKey: 'mock', claims: { async claim() { return true; } }, fetch: async (_url, init) => {
    if (init?.method === 'POST') { const row = { _id: 'full-deposit', ...JSON.parse(String(init.body)) }; deposits.push(row); return Response.json(row); }
    return Response.json(String(_url).includes('/deposits') ? deposits : { balance: 0 });
  } });
  const { store, lease } = await job();
  const service = new PaymentService({ bank, accountId: 'mock', lookup: async () => ({ ...link, amountCents: 495000 }) });
  await service.pay(link.id);
  expect(await service.reconcile(link.id, store, lease, 'promised')).toMatchObject({ status: 'paid' });
  expect((await service.view(link.id)).balance.accountBalance).toBe(0);
});
it('requires previous installment receipts and sums only those receipts for the final installment', async () => {
  const bank = new (await import('../core-demo/bank')).FakeDemoBank();
  const links = [link, { ...link, id: 'second-link', installment: 2 }];
  const service = new PaymentService({ bank, accountId: 'mock', lookup: async id => links.find(row => row.id === id) });
  const { store, lease } = await job();
  await service.pay(link.id); await service.reconcile(link.id, store, lease, 'promised');
  await store.completeTask(lease, 'done', Date.now());
  await store.enqueueTask({ id: 'second-job', seatId: 'collections', refs: ['1042'], steps: [], idempotencyKey: 'ar:1042:2' });
  const second = (await store.claimTask('bookkeeper', Date.now(), 12000))!;
  await service.pay('second-link');
  expect(await service.reconcile('second-link', store, second, 'partially_paid')).toMatchObject({ status: 'paid' });
  expect(await store.getPayment('ar:1042:2')).toMatchObject({ result: { amountCents: 247500, invoiceState: 'paid' } });
}, 15_000); // The first FakeDemoBank import takes 3-5 s on Windows CI-less runs; the default 5 s flakes.
it('leaves a posted receipt queued if the host reconciliation job fails', async () => {
  const bank = new (await import('../core-demo/bank')).FakeDemoBank();
  const service = new PaymentService({ bank, accountId: 'mock', lookup: async () => link,
    onPosted: async () => { throw new Error('LEASE_BUSY'); } });
  expect(await service.pay(link.id)).toMatchObject({ status: 'pending_reconciliation' });
  expect(service.pendingPayments()).toHaveLength(1);
});
it('refuses fractional sandbox dollars before issuing a bank deposit', async () => {
  const bank = new (await import('../core-demo/bank')).FakeDemoBank();
  const service = new PaymentService({ bank, accountId: 'mock', lookup: async () => ({ ...link, amountCents: 116250 }) });
  await expect(service.pay(link.id)).rejects.toThrow('SANDBOX_WHOLE_DOLLARS_REQUIRED');
  expect(await bank.listDeposits('mock')).toHaveLength(0);
});
