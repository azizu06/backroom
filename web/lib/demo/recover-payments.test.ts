import { expect, it, vi } from 'vitest';
import { NessieClient, paymentMemo, type Transaction } from '@backroom/nessie';
import { MemoryStateStore, PaymentService, type AuthorizedPaymentLink } from '@backroom/orchestrator';
import { recoverDemoPayments, selectRecoverableLinkIds } from './recover-payments';

const link: AuthorizedPaymentLink = { id: 'link-1042', invoiceId: '1042', planId: 'plan-1042', auditId: 'allow-1042',
  policyVersion: 1, installment: 1, amountCents: 247500, totalCents: 495000, currency: 'USD' };

function bank() {
  const deposits: Transaction[] = [];
  const claims = new Set<string>();
  return new NessieClient({ apiKey: 'mock-no-network', surface: 'mock', claims: { async claim(key) {
    if (claims.has(key)) return false; claims.add(key); return true;
  } }, fetch: async (url, init) => {
    if (init?.method === 'POST') {
      const row = { ...JSON.parse(String(init.body)), _id: `mock-deposit-${deposits.length + 1}` };
      deposits.push(row); return Response.json({ objectCreated: row });
    }
    return Response.json(String(url).includes('/deposits') ? deposits : { balance: 0 });
  } });
}

function service(client: NessieClient, links: AuthorizedPaymentLink[], onPosted?: (id: string) => Promise<void>) {
  return new PaymentService({ bank: client, accountId: 'mock', onPosted,
    lookup: async id => links.find(row => row.id === id) });
}

async function promised() {
  const store = new MemoryStateStore(); const now = Date.now();
  await store.registerAgent('bookkeeper', 'collections', now);
  await store.enqueueTask({ id: 'reconcile-1042', seatId: 'collections', refs: ['1042'], idempotencyKey: 'ar:1042:1', steps: [] });
  await store.insertInvoice({ id: '1042', kind: 'ar', state: 'promised' });
  return { store, lease: (await store.claimTask('bookkeeper', now, 12000))! };
}

it('restores a restarted link with a deposit and receipt as paid', async () => {
  const client = bank(); const paid = { ...link, totalCents: link.amountCents };
  const { store, lease } = await promised();
  const first = service(client, [paid]);
  const deposit = vi.spyOn(client, 'deposit');
  await first.pay(paid.id);
  expect((await first.reconcile(paid.id, store, lease, 'promised')).status).toBe('paid');
  const restarted = service(client, [paid]);
  const decision = selectRecoverableLinkIds([{ id: paid.id, invoiceId: paid.invoiceId, installment: paid.installment }],
    await client.listDeposits('mock'), []);
  expect(decision).toEqual({ ids: [paid.id], skipped: [] });
  await recoverDemoPayments(restarted, decision.ids, store);
  expect((await restarted.view(paid.id)).payment?.status).toBe('paid');
  expect(deposit).toHaveBeenCalledTimes(1);
  expect(await store.getPayment('ar:1042:1')).toMatchObject({ result: { invoiceState: 'paid', amountCents: paid.amountCents } });
});

it('restores a deposit without a receipt as pending_reconciliation and the sweep finishes it', async () => {
  const client = bank(); const { store, lease } = await promised();
  const first = service(client, [link]);
  const deposit = vi.spyOn(client, 'deposit');
  expect((await first.pay(link.id)).status).toBe('pending_reconciliation');
  expect(await store.getPayment('ar:1042:1')).toBeUndefined();
  let restarted!: PaymentService;
  restarted = service(client, [link], async id => { await restarted.reconcile(id, store, lease, 'promised'); });
  await recoverDemoPayments(restarted, [link.id], store);
  expect((await restarted.view(link.id)).payment?.status).toBe('pending_reconciliation');
  expect(await restarted.retryPending()).toEqual([{ linkId: link.id, ok: true }]);
  expect((await restarted.view(link.id)).payment?.status).toBe('partially_paid');
  expect(deposit).toHaveBeenCalledTimes(1);
});

it('leaves a restored payment unchanged when recovery runs twice', async () => {
  const client = bank(); const paid = { ...link, totalCents: link.amountCents };
  const { store, lease } = await promised();
  const first = service(client, [paid]);
  const deposit = vi.spyOn(client, 'deposit');
  await first.pay(paid.id);
  await first.reconcile(paid.id, store, lease, 'promised');
  const restarted = service(client, [paid]);
  await recoverDemoPayments(restarted, [paid.id], store);
  const restored = (await restarted.view(paid.id)).payment;
  await recoverDemoPayments(restarted, [paid.id], store);
  expect((await restarted.view(paid.id)).payment).toEqual(restored);
  expect(restored?.status).toBe('paid');
  expect(deposit).toHaveBeenCalledTimes(1);
  expect(await store.getPayment('ar:1042:1')).toMatchObject({ result: { invoiceState: 'paid' } });
});

it('skips a new link id when the invoice installment deposit already exists', async () => {
  const client = bank(); const { store } = await promised();
  const first = service(client, [link]);
  await first.pay(link.id);
  const fresh = { ...link, id: 'new-link' };
  const prior = await client.listDeposits('mock');
  const decision = selectRecoverableLinkIds([{ id: fresh.id, invoiceId: fresh.invoiceId, installment: fresh.installment }],
    prior, [fresh.id]);
  expect(decision).toEqual({ ids: [], skipped: [{ linkId: fresh.id, reason: 'NEW_LINK_EXISTING_DEPOSIT' }] });
  expect(prior.map(row => row.description)).toEqual([paymentMemo({ invoiceId: '1042', installment: 1 })]);
  const restarted = service(client, [link, fresh]);
  await recoverDemoPayments(restarted, decision.ids, store);
  expect((await restarted.view(fresh.id)).payment).toBeUndefined();
  const hazard = service(client, [fresh]);
  expect((await hazard.recover([fresh.id], store)).restored.map(row => row.linkId)).toEqual([fresh.id]);
  expect((await hazard.view(fresh.id)).payment?.depositId).toBe(prior[0]!._id);
});
