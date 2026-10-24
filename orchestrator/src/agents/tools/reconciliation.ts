import { z } from 'zod';
import type { NessieClient } from '@backroom/nessie';
import { inspectPaymentEvidence, matchRemittance, reconcileAlreadyPaid, type PaymentService } from '../../payments';
import type { FinanceRepository } from '../../payables/types';
import type { InvoiceState, Lease, StateStore } from '../../store';
import type { DomainTool, Json, ToolContext } from '../contracts';

/** Loaded from the trusted case ledger on every tool call, never from a model packet. */
export interface ReconciliationCase {
  caseId: string; invoiceRef: string; invoiceId: string; accountId: string;
  amountCents: number; expectedMemo: string; state: InvoiceState; lease: Lease;
  /** Persisted count of accepted collections correction returns, maintained by the host. */
  correctionReturns: number;
  paymentLinkId?: string;
  vendorId?: string;
}
export interface ReconciliationDependencies {
  store: StateStore;
  bank: Pick<NessieClient, 'listDeposits'>;
  loadCase(ctx: ToolContext): Promise<ReconciliationCase>;
  payments?: Pick<PaymentService, 'view' | 'reconcile'>;
  finance?: Pick<FinanceRepository, 'getInvoice'>;
}
export const MAX_RECONCILIATION_RETURNS = 2;
const empty = z.strictObject({});
const exceptionInput = z.strictObject({ reason: z.string().trim().min(1).max(500) });

/** No arbitrary invoice/account selectors, amounts, approvals or receipt imports. */
export function createReconciliationTools(deps: ReconciliationDependencies): readonly DomainTool<any, Json>[] {
  async function current(ctx: ToolContext) {
    await ctx.assertCurrent();
    if (ctx.activation.role !== 'reconciler' || ctx.activation.signal.aborted) throw new Error('RECONCILER_AUTHORITY_REQUIRED');
    const row = await deps.loadCase(ctx);
    if (row.caseId !== ctx.activation.caseId || !ctx.activation.artifactRefs.includes(row.invoiceRef)
      || !row.invoiceId || !row.expectedMemo.trim() || !Number.isSafeInteger(row.amountCents) || row.amountCents <= 0
      || !Number.isSafeInteger(row.correctionReturns) || row.correctionReturns < 0
      || row.lease.id !== ctx.activation.taskId || row.lease.leaseOwner !== ctx.activation.leaseOwner
      || row.lease.leaseToken !== ctx.activation.leaseToken || !row.lease.refs.includes(row.invoiceId)
      || row.lease.seatId !== 'collections') throw new Error('RECONCILIATION_CASE_MISMATCH');
    await deps.store.assertLease(row.lease, Date.now());
    await ctx.assertCurrent();
    return row;
  }
  async function audit(ctx: ToolContext, row: ReconciliationCase, ruleId: string, inputs: Record<string, unknown>) {
    const policy = await deps.store.getPolicy();
    await ctx.assertCurrent();
    const entry = await deps.store.appendAudit({ ts: Date.now(), actor: 'code', seat: 'collections',
      action: 'agent_reconciliation', ruleIds: [ruleId], policyVersion: policy.policyVersion,
      refs: [row.invoiceId, row.invoiceRef], route: 'code', inputs, latencyMs: 0, costUsd: 0 });
    await ctx.assertCurrent();
    // The host must register this persisted audit as a private case artifact for handoff validation.
    return entry.id;
  }
  async function exception(ctx: ToolContext, row: ReconciliationCase, ruleId: string, reason?: string) {
    const next = ruleId === 'RECON_UNMATCHED' && row.correctionReturns < MAX_RECONCILIATION_RETURNS ? 'collections' : 'auditor';
    const evidenceRef = await audit(ctx, row, ruleId, { stateUnchanged: true, correctionReturns: row.correctionReturns,
      followup: next === 'collections' ? 'request_missing_proof' : 'review_exception', ...(reason ? { reasonProvided: true } : {}) });
    return { decision: 'ESCALATE', status: 'exception', ruleId, next, artifactRefs: [row.invoiceRef, evidenceRef] };
  }
  // Legacy deterministic services perform multiple awaits. Fence every store operation,
  // including each mutation, against OFF/generation and lease changes during that work.
  function fencedStore(ctx: ToolContext): StateStore {
    return new Proxy(deps.store, { get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        await ctx.assertCurrent();
        const result = await value.apply(target, args);
        await ctx.assertCurrent();
        return result;
      };
    } });
  }
  return [
    { name: 'read_bank_feed', description: 'Read this case’s Nessie sandbox deposits; no balance display is settlement evidence.', input: empty,
      async execute(ctx, input): Promise<Json> {
        empty.parse(input); const row = await current(ctx);
        const deposits = await deps.bank.listDeposits(row.accountId);
        await ctx.assertCurrent();
        return { decision: 'ALLOW', label: 'Nessie sandbox deposits', invoiceRef: row.invoiceRef,
          deposits: deposits.map(item => ({ id: item._id, amount: item.amount, memo: item.description, status: item.status, medium: item.medium })) };
      } },
    { name: 'read_payment_receipts', description: 'Read trusted reducer, payment-link and x402 testnet receipts for this invoice. Speech is not proof.', input: empty,
      async execute(ctx, input): Promise<Json> {
        empty.parse(input); const row = await current(ctx);
        const receipts: Json[] = [];
        const receipt = await deps.store.getPayment(`ar:${row.invoiceId}:1`);
        if (receipt) receipts.push({ rail: 'nessie', source: 'reducer', key: receipt.key,
          depositId: typeof receipt.result.depositId === 'string' ? receipt.result.depositId : null,
          amountCents: typeof receipt.result.amountCents === 'number' ? receipt.result.amountCents : null,
          invoiceState: typeof receipt.result.invoiceState === 'string' ? receipt.result.invoiceState : null });
        if (row.paymentLinkId && deps.payments) {
          const view = await deps.payments.view(row.paymentLinkId);
          if (view.invoiceId !== row.invoiceId) throw new Error('RECON_RECEIPT_CASE_MISMATCH');
          receipts.push({ rail: 'nessie', source: 'payment_link', linkId: view.linkId, amountCents: view.amountCents,
            status: view.payment?.status ?? 'not_posted', depositId: view.payment?.depositId ?? null });
        }
        if (row.vendorId && deps.finance) {
          const invoice = await deps.finance.getInvoice(row.vendorId, row.invoiceId);
          if (invoice && (invoice.fields.invoiceId !== row.invoiceId || invoice.fields.vendorId !== row.vendorId)) throw new Error('RECON_RECEIPT_CASE_MISMATCH');
          if (invoice?.result.receiptId) receipts.push({ rail: invoice.result.paymentRail ?? 'nessie', source: 'payables',
            receiptId: invoice.result.receiptId, status: invoice.result.status, amountCents: invoice.fields.amountCents,
            label: invoice.result.paymentRail === 'x402 testnet' ? 'Base Sepolia testnet; not an AR deposit' : 'Nessie sandbox' });
        }
        await ctx.assertCurrent();
        return { decision: 'ALLOW', invoiceRef: row.invoiceRef, receipts };
      } },
    { name: 'request_exact_match', description: 'Ask deterministic reconciliation to check the trusted invoice/memo against fresh deposits. Never supplies match verdicts or amounts.', input: empty,
      async execute(ctx, input): Promise<Json> {
        empty.parse(input); const row = await current(ctx);
        if (row.paymentLinkId) {
          if (!deps.payments) return { decision: 'DENY', ruleId: 'RECON_PAYMENT_SERVICE_REQUIRED' };
          const view = await deps.payments.view(row.paymentLinkId);
          if (view.invoiceId !== row.invoiceId || view.amountCents !== row.amountCents) throw new Error('RECON_RECEIPT_CASE_MISMATCH');
          await ctx.assertCurrent();
          const result = await deps.payments.reconcile(row.paymentLinkId, fencedStore(ctx), row.lease, row.state);
          await ctx.assertCurrent();
          if (result.status === 'exception') return exception(ctx, row, 'RECON_PAYMENT_LINK_EXCEPTION');
          const evidenceRef = await audit(ctx, row, 'EXACT_PAYMENT_MATCH', { depositId: result.depositId, invoiceState: result.status });
          return { decision: 'ALLOW', status: result.status, next: 'auditor', artifactRefs: [row.invoiceRef, evidenceRef] };
        }
        const feed = await deps.bank.listDeposits(row.accountId);
        await ctx.assertCurrent();
        // Do not invoke the legacy already-paid job's controller escalation for missing proof:
        // a bounded collections return is the specialist's correction path.
        if (!matchRemittance({ amountCents: row.amountCents, memo: row.expectedMemo }, feed)) {
          const evidence = inspectPaymentEvidence({ linkId: row.invoiceRef, amountCents: row.amountCents, memo: row.expectedMemo }, feed);
          return exception(ctx, row, evidence.ruleId ?? 'RECON_MISMATCH');
        }
        const policy = await deps.store.getPolicy();
        await ctx.assertCurrent();
        const result = await reconcileAlreadyPaid({ invoiceId: row.invoiceId, totalCents: row.amountCents,
          expectedMemo: row.expectedMemo, policyVersion: policy.policyVersion }, feed, fencedStore(ctx), row.lease, row.state);
        await ctx.assertCurrent();
        const evidenceRef = await audit(ctx, row, 'EXACT_PAYMENT_MATCH', { depositId: result.depositId, invoiceState: result.status });
        return { decision: 'ALLOW', status: result.status, next: 'auditor', artifactRefs: [row.invoiceRef, evidenceRef] };
      } },
    { name: 'record_exception', description: 'Record missing or contradictory evidence without changing money or invoice state. Cannot authorize a refund or credit.', input: exceptionInput,
      async execute(ctx, input): Promise<Json> {
        const { reason } = exceptionInput.parse(input); const row = await current(ctx);
        return exception(ctx, row, 'RECON_MODEL_EXCEPTION', reason);
      } },
  ];
}
