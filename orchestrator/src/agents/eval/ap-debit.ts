import { NessieClient, type Transaction } from '@backroom/nessie';
import { createNorthfieldRepository, nessieDebitPayables } from '../../payables';
import { MemoryStateStore } from '../../store';
import { runInvoice } from './chain';

/** Real AP adapter/SDK over an explicitly simulated bank transport. Never a live debit receipt. */
export async function runApDebit(mode: 'exact' | 'mismatch' = 'exact') {
  const feed: Transaction[] = [];
  const claims = new Set<string>();
  let posts = 0;
  const bank = new NessieClient({ apiKey: 'offline-no-key', surface: 'mock', claims: {
    async claim(key) { if (claims.has(key)) return false; claims.add(key); return true; },
  }, fetch: async (url, init) => {
    if (new URL(String(url)).pathname !== '/accounts/offline-operating/withdrawals') throw new Error('UNEXPECTED_BANK_PATH');
    if (init?.method === 'POST') {
      posts++;
      const row = { ...JSON.parse(String(init.body)), _id: 'offline:P01:withdrawal', transaction_date: '2026-10-24' };
      feed.push(row);
      return Response.json({ objectCreated: row }, { status: 201 });
    }
    return Response.json(feed.map(row => mode === 'mismatch' ? { ...row, amount: row.amount + 1 } : row));
  } });
  const repository = await createNorthfieldRepository();
  const state = new MemoryStateStore();
  const paymentClient = nessieDebitPayables(bank, 'offline-operating');
  const first = await runInvoice('4401', { caseId: `P01:debit:${mode}`, repository, state, paymentClient });
  const repeat = await runInvoice('4401', { caseId: `P01:debit:${mode}:repeat`, repository, state, paymentClient });
  const audits = await state.listAudit();
  const reconciliations = audits.filter(row => row.action === 'reconcile');
  const reconciliation = first.result.reconciliation as Record<string, unknown> | undefined;
  const checks = {
    dispatcherDone: first.runtime.status === 'done' && repeat.runtime.status === 'done',
    productionRoles: first.runtime.activations.map(row => row.role).join(',') === 'intake,extractor,vendor,payables,auditor',
    allowedInBadge: first.assessment.verdict === 'ALLOW' && (first.assessment.ruleIds as string[]).includes('IN_BADGE'),
    paid: first.result.status === 'paid',
    exactWithdrawal: reconciliation?.match === 'EXACT' && reconciliation.debitId === 'offline:P01:withdrawal'
      && reconciliation.transactionId === reconciliation.debitId && reconciliation.amountCents === 64000,
    paidOnce: posts === 1 && feed.length === 1 && repeat.result.receiptId === first.result.receiptId,
    reconciledAudit: reconciliations.some(row => row.decision === 'ALLOW' && row.ruleIds.includes('EXACT_PAYMENT_MATCH')
      && row.inputs?.transactionKind === 'withdrawal' && row.inputs?.debitId === first.result.receiptId),
    auditChain: (await state.verifyAuditChain()).valid,
  };
  const project = (row: typeof first) => ({ result: row.result, assessment: row.assessment, runtime: row.runtime });
  return { id: 'P01', mode, match: Object.values(checks).every(Boolean), checks, posts,
    first: project(first), repeat: project(repeat),
    reconciliations: reconciliations.map(row => ({ action: row.action, decision: row.decision, ruleIds: row.ruleIds, inputs: row.inputs })),
    scope: 'Production Dispatcher + ClaudeAgentRuntime scripted QueryFn -> Payables request_payment -> PayablesSeat -> nessieDebitPayables -> NessieClient.withdraw/reconcileWithdrawal. Bank HTTP responses and claims are synthetic; no network, live sandbox debit, paid model call or durable restart. Two fresh dispatcher cases share the trusted finance repository and bank claim store and produce one withdrawal.',
  };
}
