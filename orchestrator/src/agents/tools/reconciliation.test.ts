import { expect, it } from 'vitest';
import type { Decision } from '@backroom/policy';
import { createReconciler } from '../roles/reconciler';
import { PaymentService } from '../../payments';
import { FakeDemoBank } from '../../core-demo/bank';
import { MemoryFinanceRepository } from '../../payables/repository';
import { MemoryStateStore } from '../../store';
import type { Transaction } from '@backroom/nessie';
import { createReconciliationTools, type ReconciliationDependencies } from './reconciliation';
import type { ToolContext } from '../contracts';

async function setup(feed: Transaction[] = []) {
  const store = new MemoryStateStore();
  await store.registerAgent('runner', 'collections', Date.now());
  await store.enqueueTask({ id: 'task', seatId: 'collections', refs: ['inv'], steps: [], idempotencyKey: 'ar:inv:1' });
  await store.insertInvoice({ id: 'inv', kind: 'ar', state: 'promised' });
  const lease = (await store.claimTask('runner', Date.now(), 60000))!;
  const ctx: ToolContext = { activation: { caseId: 'case', taskId: lease.id, activationId: 'activation', role: 'reconciler',
    leaseOwner: lease.leaseOwner, leaseToken: lease.leaseToken, llmGeneration: 1, artifactRefs: ['case:invoice'],
    credentialOwnerId: 'test', signal: new AbortController().signal }, async assertCurrent() { await store.assertLease(lease, Date.now()); } };
  const dependencies: ReconciliationDependencies = { store, bank: { async listDeposits() { return feed; } },
    async loadCase() { return { caseId: 'case', invoiceRef: 'case:invoice', invoiceId: 'inv', accountId: 'trusted-account',
      amountCents: 4200, expectedMemo: 'trusted-memo', state: 'promised', lease, correctionReturns: 0 }; } };
  const tools = createReconciliationTools(dependencies);
  return { store, ctx, dependencies, tools, async request() { return tools.find(tool => tool.name === 'request_exact_match')!.execute(ctx, {}); } };
}
const deposit: Transaction = { _id: 'deposit', amount: 42, description: 'trusted-memo', status: 'completed', medium: 'balance', transaction_date: '2026-10-24' };
it('clears an already-paid claim only through the existing code-owned exact matcher', async () => {
  const job = await setup([deposit]);
  expect(await job.request()).toMatchObject({ decision: 'ALLOW', status: 'paid', next: 'auditor' });
  expect(await job.store.getPayment('ar:inv:1')).toMatchObject({ result: { depositId: 'deposit', amountCents: 4200 } });
});

it.each([
  ['missing', [], 'RECON_UNMATCHED', 'collections'],
  ['partial', [{ ...deposit, amount: 20 }], 'RECON_SHORT', 'auditor'],
  ['ambiguous', [deposit, { ...deposit, _id: 'second' }], 'RECON_DUPLICATE', 'auditor'],
  ['pending', [{ ...deposit, status: 'pending' }], 'RECON_MISMATCH', 'auditor'],
] as const)('records a %s claim as an exception without clearing the invoice', async (_name, feed, ruleId, next) => {
  const job = await setup([...feed]);
  expect(await job.request()).toMatchObject({ decision: 'ESCALATE', status: 'exception', ruleId, next });
  expect(await job.store.getPayment('ar:inv:1')).toBeUndefined();
});

it('rejects model-supplied amounts and foreign case authority before using bank evidence', async () => {
  const job = await setup([deposit]);
  const match = job.tools.find(tool => tool.name === 'request_exact_match')!;
  await expect(match.execute(job.ctx, { amountCents: 1, approved: true })).rejects.toThrow();
  job.ctx.activation.caseId = 'other';
  await expect(job.request()).rejects.toThrow('RECONCILIATION_CASE_MISMATCH');
  expect(await job.store.getPayment('ar:inv:1')).toBeUndefined();
});

it('removes the collections handoff capability after two persisted correction returns', async () => {
  const job = await setup();
  const load = job.dependencies.loadCase;
  job.dependencies.loadCase = async ctx => ({ ...await load(ctx), correctionReturns: 2 });
  expect((await createReconciler(job.dependencies, job.ctx)).allowedNext).toEqual(['auditor']);
  expect(await job.request()).toMatchObject({ next: 'auditor', status: 'exception' });
});

it('fences a stale model generation between bank evidence and a reducer mutation', async () => {
  const job = await setup([deposit]);
  const getPayment = job.store.getPayment.bind(job.store);
  job.store.getPayment = async key => { const receipt = await getPayment(key); await job.store.setLlmEnabled(false); return receipt; };
  job.ctx.assertCurrent = async () => {
    if (!job.store.llmEnabled) throw new Error('LLM_GENERATION_STALE');
    await job.store.assertLease((await job.dependencies.loadCase(job.ctx)).lease, Date.now());
  };
  await expect(job.request()).rejects.toThrow('LLM_GENERATION_STALE');
  expect(await job.store.getPayment('ar:inv:1')).toBeUndefined();
});

it('reads payment-link and stored x402 evidence without counting testnet receipts as AR deposits', async () => {
  const job = await setup();
  const bank = new FakeDemoBank();
  job.dependencies.bank = bank;
  const payments = new PaymentService({ bank, accountId: 'trusted-account', lookup: async () => ({ id: 'link', invoiceId: 'inv',
    planId: 'plan', auditId: 'allow', policyVersion: 1, installment: 1, amountCents: 4200, totalCents: 8400, currency: 'USD' }) });
  job.dependencies.payments = payments;
  const finance = new MemoryFinanceRepository();
  const decision: Decision = { kind: 'ALLOW', ruleIds: [], policyVersion: 1 };
  await finance.saveInvoice({ fields: { kind: 'invoice', invoiceId: 'inv', vendorId: 'vendor', poId: null, amountCents: 4200,
    currency: 'USD', bankAccountId: 'private-destination', lineItems: [] },
    policyInvoice: { vendorId: 'vendor', amountCents: 4200, lineItems: [], poMatched: true, account: 'private-account' },
    result: { status: 'paid', decision, receiptId: 'testnet-transaction', paymentRail: 'x402 testnet', evidenceRefs: [] },
    fingerprint: 'private-fingerprint', vendorRevision: 1, paymentAttempted: true });
  job.dependencies.finance = finance;
  const load = job.dependencies.loadCase;
  job.dependencies.loadCase = async ctx => ({ ...await load(ctx), vendorId: 'vendor' });
  const read = job.tools.find(tool => tool.name === 'read_payment_receipts')!;
  expect(await read.execute(job.ctx, {})).toMatchObject({ receipts: [{ rail: 'x402 testnet', receiptId: 'testnet-transaction' }] });
  expect(JSON.stringify(await read.execute(job.ctx, {}))).not.toContain('private-');
  expect(await job.request()).toMatchObject({ status: 'exception', ruleId: 'RECON_UNMATCHED' });
  expect(await job.store.getPayment('ar:inv:1')).toBeUndefined();

  job.dependencies.loadCase = async ctx => ({ ...await load(ctx), paymentLinkId: 'link' });
  await payments.pay('link');
  expect(await read.execute(job.ctx, {})).toMatchObject({ receipts: [{ source: 'payment_link', status: 'pending_reconciliation', amountCents: 4200 }] });
  expect(await job.request()).toMatchObject({ decision: 'ALLOW', status: 'partially_paid', next: 'auditor' });
  expect(await job.store.getPayment('ar:inv:1')).toMatchObject({ result: { invoiceState: 'partially_paid', amountCents: 4200 } });
});

it('records a model exception without exposing document instructions on the public audit', async () => {
  const job = await setup();
  const tool = job.tools.find(tool => tool.name === 'record_exception')!;
  expect(await tool.execute(job.ctx, { reason: 'private-injected-instructions' })).toMatchObject({ decision: 'ESCALATE', next: 'auditor' });
  expect(JSON.stringify(await job.store.listAudit())).not.toContain('private-injected-instructions');
  expect(await job.store.getPayment('ar:inv:1')).toBeUndefined();
});
