import { expect, it, vi } from 'vitest';
import { NessieClient } from '@backroom/nessie';
import { MemoryStateStore } from '../store';
import { payablesSpecialist } from '../agents/roles/payables';
import type { Activation, DomainTool, Json, ToolContext } from '../agents/contracts';
import { PayablesSeat, nessieDebitPayables } from './index';
import { createNorthfieldRepository, northfieldInvoice, northfieldSource } from './northfield';

it('debits a clean P01 invoice once, matches the withdrawal feed, and records exact audit evidence', async () => {
  const withdrawals: unknown[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(new URL(String(url)).pathname).toBe('/accounts/sandbox-operating/withdrawals');
    if (init?.method === 'POST') {
      const row = { _id: 'nessie-debit-4401', ...JSON.parse(String(init.body)) };
      withdrawals.push(row);
      return Response.json({ objectCreated: row }, { status: 201 });
    }
    return Response.json(withdrawals);
  });
  const claims = new Set<string>();
  const bank = new NessieClient({ apiKey: 'mock-key', fetch: fetcher, claims: {
    async claim(key) { if (claims.has(key)) return false; claims.add(key); return true; },
  } });
  const repository = await createNorthfieldRepository();
  const state = new MemoryStateStore();
  const controller = { request: vi.fn(async () => 'esc-1') };
  const seat = new PayablesSeat({ repository, state, controller,
    nessie: nessieDebitPayables(bank, 'sandbox-operating') });

  const fields = northfieldInvoice('4401'), source = northfieldSource('4401');
  const specialist = payablesSpecialist({ seat, repository, controller, loadCase: async () => ({ fields, source }) });
  const tool = specialist.tools.find(row => row.name === 'request_payment')! as DomainTool<unknown, Json>;
  const activation: Activation = { caseId: 'P01', taskId: 'P01', activationId: 'P01:payables', role: 'payables',
    leaseOwner: 'test', leaseToken: 1, llmGeneration: 1, artifactRefs: [source.id], credentialOwnerId: 'test',
    signal: new AbortController().signal };
  const ctx: ToolContext = { activation, assertCurrent: async () => {} };
  const first = await tool.execute(ctx, tool.input.parse({})) as Record<string, any>;
  expect(first).toMatchObject({ status: 'paid', receiptId: 'nessie-debit-4401',
    reconciliation: { match: 'EXACT', debitId: 'nessie-debit-4401', transactionId: 'nessie-debit-4401' } });
  expect(await seat.process(fields, source)).toMatchObject({ status: 'paid', receiptId: 'nessie-debit-4401',
    reconciliation: { match: 'EXACT', debitId: 'nessie-debit-4401', transactionId: 'nessie-debit-4401' } });
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect(controller.request).not.toHaveBeenCalled();
  expect((await state.listAudit()).find(row => row.action === 'reconcile')).toMatchObject({
    actor: 'code', seat: 'payables', decision: 'ALLOW', ruleIds: ['EXACT_PAYMENT_MATCH'],
    refs: expect.arrayContaining(['4401', 'nessie-debit-4401']),
    inputs: { transactionKind: 'withdrawal', match: 'EXACT', debitId: 'nessie-debit-4401',
      transactionId: 'nessie-debit-4401', invoiceId: '4401', amountCents: 64000 },
  });
});

it('holds and escalates when the posted debit does not exactly match the withdrawal read-back', async () => {
  let reads = 0;
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'POST') return Response.json({ objectCreated: {
      _id: 'nessie-debit-mismatch', ...JSON.parse(String(init.body)),
    } }, { status: 201 });
    reads += 1;
    return Response.json(reads === 1 ? [] : [{ _id: 'nessie-debit-mismatch', medium: 'balance',
      transaction_date: '2026-10-24', status: 'completed', amount: 1,
      description: 'backroom:ap_vendor=papertrail:invoice=4401' }]);
  });
  const bank = new NessieClient({ apiKey: 'mock-key', fetch: fetcher, claims: { async claim() { return true; } } });
  const repository = await createNorthfieldRepository();
  const state = new MemoryStateStore();
  const controller = { request: vi.fn(async () => 'esc-mismatch') };
  const seat = new PayablesSeat({ repository, state, controller,
    nessie: nessieDebitPayables(bank, 'sandbox-operating') });

  const result = await seat.process(northfieldInvoice('4401'), northfieldSource('4401'));
  expect(result).toMatchObject({ status: 'held', receiptId: 'nessie-debit-mismatch', escalationId: 'esc-mismatch',
    reconciliation: { match: 'MISMATCH', debitId: 'nessie-debit-mismatch', amountCents: 64000 } });
  expect((await state.listAudit()).find(row => row.action === 'reconcile')).toMatchObject({
    decision: 'ESCALATE', ruleIds: ['RECON_MISMATCH'],
    inputs: { transactionKind: 'withdrawal', match: 'MISMATCH', invoiceId: '4401', amountCents: 64000 },
  });
});
