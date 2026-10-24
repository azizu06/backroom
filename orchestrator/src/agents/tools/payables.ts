import { z } from 'zod';
import type { Decision, RuleId } from '@backroom/policy';
import { RULE_SENTENCES, POLICY_SENTENCES } from '@backroom/policy';
import { hold } from '../../payables/decisions';
import type { ControllerPort, FinanceRepository, InboxSource, InvoiceFields, PayablesSeat, SeatResult } from '../../payables';
import type { DomainTool, Json, ToolContext } from '../contracts';

/** Trusted case record for this activation. Resolved server-side from the activation's
 * artifact refs; the model never supplies invoice fields, amounts, vendor or sender. */
export interface PayablesCase { fields: InvoiceFields; source: InboxSource }
export interface PayablesToolDeps {
  seat: Pick<PayablesSeat, 'assess' | 'process'>;
  repository: Pick<FinanceRepository, 'getPO' | 'listInvoices'>;
  controller: ControllerPort;
  loadCase(ctx: ToolContext): Promise<PayablesCase>;
}

export const HOLD_RULES = ['DUPLICATE_INVOICE', 'LOOKALIKE_DOMAIN', 'BANK_CHANGE_HOLD', 'NO_PO', 'OVER_LIMIT', 'PAYEE_NOT_IN_MASTER'] as const satisfies readonly RuleId[];
const none = z.object({}).strict();
const humanInput = z.object({ rule: z.enum(HOLD_RULES) }).strict();

function verdict(decision: Decision): Record<string, Json> {
  const sentenceId = decision.ruleIds[0] ? RULE_SENTENCES[decision.ruleIds[0]] : undefined;
  return { verdict: decision.kind, ruleIds: [...decision.ruleIds], policyVersion: decision.policyVersion,
    ...(decision.kind !== 'ALLOW' && { policySentence: decision.reason }),
    ...(decision.kind === 'ALLOW' && sentenceId && { policySentence: POLICY_SENTENCES[sentenceId] }) };
}
function outcome(result: SeatResult): Record<string, Json> {
  return { status: result.status, ...verdict(result.decision), ...(result.paymentRail && { rail: result.paymentRail }),
    ...(result.receiptId && { receiptId: result.receiptId }), ...(result.escalationId && { escalationId: result.escalationId }),
    evidenceRefs: result.evidenceRefs };
}
const lines = (rows: InvoiceFields['lineItems']) => rows.slice(0, 20).map(row => ({
  // Document-derived text is data, never instructions; bound it before it reaches a prompt.
  description: row.description.slice(0, 80), quantity: row.quantity, unitPriceCents: row.unitPriceCents }));

/** Payables' whole tool surface. Every handler re-checks the activation, rebuilds trusted
 * context from the case port, and lets the seat (policy + vendor master + idempotent bank
 * boundary) decide. The model chooses WHICH tool to call; none accept an amount, payee,
 * account, approval flag or idempotency key. */
export function createPayablesTools(deps: PayablesToolDeps): readonly DomainTool<any, Json>[] {
  // One payment request and one human request per activation, even if the model repeats it.
  const payments = new Map<string, Promise<Record<string, Json>>>();
  const humans = new Map<string, Promise<Record<string, Json>>>();
  const guarded = async <T>(ctx: ToolContext, work: () => Promise<T>): Promise<T> => {
    await ctx.assertCurrent();
    const value = await work();
    await ctx.assertCurrent();
    return value;
  };
  const readPo: DomainTool<z.infer<typeof none>, Json> = {
    name: 'read_po', input: none,
    description: 'Read the purchase order referenced by this case invoice and report whether vendor, total and line items match it exactly. Takes no arguments.',
    execute: (ctx) => guarded(ctx, async (): Promise<Record<string, Json>> => {
      const { fields } = await deps.loadCase(ctx);
      if (!fields.poId) return { poId: null, found: false, note: 'invoice references no purchase order' };
      const po = await deps.repository.getPO(fields.poId);
      if (!po) return { poId: fields.poId, found: false };
      return { poId: po.id, found: true, vendorMatches: po.vendorId === fields.vendorId,
        amountMatches: po.amountCents === fields.amountCents, poAmountCents: po.amountCents,
        invoiceAmountCents: fields.amountCents, lineItems: lines(po.lineItems) };
    }),
  };
  const readHistory: DomainTool<z.infer<typeof none>, Json> = {
    name: 'read_invoice_history', input: none,
    description: "List this vendor's earlier invoices from the ledger (id, amount, whether payment was attempted) to judge duplicates. Takes no arguments.",
    execute: (ctx) => guarded(ctx, async () => {
      const { fields } = await deps.loadCase(ctx);
      const rows = await deps.repository.listInvoices(fields.vendorId);
      return { vendorId: fields.vendorId, thisInvoiceId: fields.invoiceId, invoices: rows.slice(-20).map(row => ({
        invoiceId: row.fields.invoiceId, amountCents: row.fields.amountCents, status: row.result.status,
        paymentAttempted: row.paymentAttempted, lineItems: lines(row.fields.lineItems) })) };
    }),
  };
  const evaluateInvoice: DomainTool<z.infer<typeof none>, Json> = {
    name: 'evaluate_invoice', input: none,
    description: 'Dry-run the payables policy on this case invoice. Returns ALLOW/DENY/ESCALATE with rule ids and the policy sentence. Changes nothing and pays nothing. Takes no arguments.',
    execute: (ctx) => guarded(ctx, async () => {
      const { fields, source } = await deps.loadCase(ctx);
      const view = await deps.seat.assess(fields, source);
      return { invoice: { invoiceId: fields.invoiceId, vendorId: fields.vendorId, poId: fields.poId, amountCents: fields.amountCents,
        currency: fields.currency, lineItems: lines(fields.lineItems) },
        ...verdict(view.decision), bankDetailsChanged: view.bankChanged, poMatched: view.poMatched,
        senderDomain: source.senderDomain, duplicateOfInvoiceIds: view.priorInvoiceIds };
    }),
  };
  const requestPayment: DomainTool<z.infer<typeof none>, Json> = {
    name: 'request_payment', input: none,
    description: 'Ask the policy-gated payment boundary to pay THIS case invoice. Amount, payee and account are rebuilt from trusted records; code re-evaluates policy and either pays, holds, or opens a human review. Safe to call once; repeats return the same result. Takes no arguments.',
    execute: (ctx) => {
      const key = ctx.activation.activationId;
      const existing = payments.get(key);
      if (existing) return existing;
      const run = guarded(ctx, async () => {
        // A requested human review closes the payment path for this activation.
        if (humans.has(key)) return { status: 'held', verdict: 'ESCALATE', note: 'human review already requested; no payment made' };
        const { fields, source } = await deps.loadCase(ctx);
        // The seat re-checks ownership synchronously at the effect boundary, after this await.
        return outcome(await deps.seat.process(fields, source, ctx.fence ? { fence: () => ctx.fence!() } : undefined));
      });
      payments.set(key, run);
      run.catch(() => payments.delete(key));
      return run;
    },
  };
  const requestHuman: DomainTool<z.infer<typeof humanInput>, Json> = {
    name: 'request_human', input: humanInput,
    description: "Escalate this invoice to the controller's passkey review when you judge it should not be paid. Pick the one policy rule that best explains the concern. Escalation only: it can never approve or pay.",
    execute: (ctx, input) => {
      const key = ctx.activation.activationId;
      const existing = humans.get(key);
      if (existing) return existing;
      const run = guarded(ctx, async (): Promise<Record<string, Json>> => {
        const paid = await payments.get(key)?.catch(() => undefined);
        if (typeof paid?.escalationId === 'string') return { escalationId: paid.escalationId, note: 'review already opened by the payment boundary' };
        const { fields, source } = await deps.loadCase(ctx);
        const decision = hold(input.rule) as Extract<Decision, { kind: 'ESCALATE' }>;
        const escalationId = await deps.controller.request(decision, [source.id, fields.invoiceId]);
        return { escalationId, ...verdict(decision), awaiting: 'controller passkey decision' };
      });
      humans.set(key, run);
      run.catch(() => humans.delete(key));
      return run;
    },
  };
  return [readPo, readHistory, evaluateInvoice, requestPayment, requestHuman];
}
