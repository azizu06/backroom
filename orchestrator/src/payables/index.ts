import { createBankChangeRiskCheck, assessBankChangeRisk } from '../vendor/crs';
import { x402Payables, X402_LABEL } from '../x402';
import { createHash } from 'node:crypto';
import { evaluate, type APInvoice, type Context, type Decision, type LineItem } from '@backroom/policy';
import { audit, domain, hold } from './decisions';
import { invoiceSchema, sourceSchema } from './schemas';
import type { FinanceRepository, InboxSource, InvoiceFields, InvoiceRecord, PayablesClient, SeatOptions, SeatResult } from './types';
export type * from './types';
export { MemoryFinanceRepository } from './repository';
export { controllerForLease } from './decisions';
export * from './northfield';
export { nessiePayables } from './payments';

function items(lines: readonly LineItem[]) {
  return JSON.stringify(lines.map(item => [item.description.trim().toLowerCase().replace(/\s+/g, ' '), item.quantity, item.unitPriceCents])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
export class PayablesSeat {
  private readonly payment?: PayablesClient;
  private readonly rail: 'nessie' | 'x402';
  constructor(private readonly options: SeatOptions & { nessie?: PayablesClient; x402?: PayablesClient; paymentRail?: string }) {
    const rail = options.paymentRail ?? process.env.PAYMENT_RAIL ?? 'nessie';
    if (rail !== 'nessie' && rail !== 'x402') throw new Error('UNKNOWN_PAYMENT_RAIL');
    this.rail = rail;
    this.payment = rail === 'x402' ? options.x402 ?? x402Payables(options) : options.nessie;
    this.risk = options.bankChangeRisk ?? createBankChangeRiskCheck();
  }
  private readonly risk: ReturnType<typeof createBankChangeRiskCheck>;
  /** Policy-only view of one invoice: no CRS call, audit write, repository write or payment.
   * Agents use it to reason before the single payment request; process() still re-evaluates. */
  async assess(unchecked: InvoiceFields, envelope: InboxSource): Promise<{ decision: Decision; priorInvoiceIds: string[]; bankChanged: boolean; poMatched: boolean }> {
    const fields = invoiceSchema.parse(unchecked), source = sourceSchema.parse(envelope);
    const repo = this.options.repository;
    const fingerprint = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
    const prior = await repo.getInvoice(fields.vendorId, fields.invoiceId);
    const vendor = await repo.getVendor(fields.vendorId);
    const prepared = await this.prepare(fields, source, fingerprint, prior, vendor);
    const { policyInvoice, bankChanged, history, context } = prepared;
    let decision = prepared.decision;
    if (bankChanged && decision.kind !== 'ALLOW' && !decision.ruleIds.includes('BANK_CHANGE_HOLD')) {
      decision = { ...decision, ruleIds: [...decision.ruleIds, 'BANK_CHANGE_HOLD'] };
    }
    if (decision.kind === 'ALLOW' && vendor && domain(source.senderDomain) !== domain(vendor.domain)) decision = hold('PAYEE_NOT_IN_MASTER');
    const priorInvoiceIds = decision.ruleIds.includes('DUPLICATE_INVOICE')
      ? [...(prior && prior.fingerprint !== fingerprint ? [prior.fields.invoiceId] : []), ...history.filter(row =>
        evaluate('payables', { type: 'pay_invoice', invoice: policyInvoice }, { ...context, priorInvoices: [row.policyInvoice] })
          .ruleIds.includes('DUPLICATE_INVOICE')).map(row => row.fields.invoiceId)] : [];
    return { decision, priorInvoiceIds: [...new Set(priorInvoiceIds)], bankChanged, poMatched: policyInvoice.poMatched };
  }
  private async prepare(fields: InvoiceFields, source: InboxSource, fingerprint: string,
    prior: InvoiceRecord | undefined, vendor: Awaited<ReturnType<FinanceRepository['getVendor']>>) {
    const repo = this.options.repository;
    const canReevaluate = prior?.fingerprint === fingerprint && !prior.paymentAttempted;
    const po = fields.poId ? await repo.getPO(fields.poId) : undefined;
    const policyInvoice: APInvoice = { id: fields.invoiceId, vendorId: fields.vendorId,
      amountCents: fields.amountCents, lineItems: fields.lineItems,
      poMatched: !!po && po.vendorId === fields.vendorId && po.amountCents === fields.amountCents && items(po.lineItems) === items(fields.lineItems),
      account: 'operating' };
    const bankChanged = !!vendor && fields.bankAccountId !== vendor.accountId;
    const history = await repo.listInvoices(fields.vendorId);
    const context: Context = {
      policy: await this.options.state.getPolicy?.(),
      vendor: vendor ? { id: vendor.id, knownDomain: vendor.domain, sourceDomain: domain(source.senderDomain),
        inMaster: vendor.inMaster ?? true, approved: vendor.approved, pendingBankChange: bankChanged || await repo.hasPendingBankChange(fields.vendorId) } : undefined,
      signals: { ofacHit: vendor?.ofacHit }, priorInvoices: history.map(row => row.policyInvoice),
    };
    const decision = prior && !canReevaluate ? hold('DUPLICATE_INVOICE') : !vendor ? hold('PAYEE_NOT_IN_MASTER')
      : evaluate('payables', { type: 'pay_invoice', invoice: policyInvoice }, context);
    return { canReevaluate, policyInvoice, bankChanged, history, context, decision };
  }
  async process(unchecked: InvoiceFields, envelope: InboxSource): Promise<SeatResult> {
    const fields = invoiceSchema.parse(unchecked), source = sourceSchema.parse(envelope);
    const repo = this.options.repository;
    return repo.withVendorLock(`vendor:${fields.vendorId}`, async () => {
      const fingerprint = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
      const prior = await repo.getInvoice(fields.vendorId, fields.invoiceId);
      const vendor = await repo.getVendor(fields.vendorId);
      if (prior?.fingerprint === fingerprint && prior.paymentAttempted) {
        await audit(this.options, 'payables', 'pay_invoice_replay', source, prior.result.decision, [fields.invoiceId],
          { paymentRail: this.rail === 'x402' ? X402_LABEL : 'nessie', receiptId: prior.result.receiptId });
        return prior.result;
      }
      const { canReevaluate, policyInvoice, bankChanged, history, context, decision: first } =
        await this.prepare(fields, source, fingerprint, prior, vendor);
      let decision = first;
      const risk = bankChanged && vendor ? await assessBankChangeRisk(this.risk, vendor.id, vendor.domain) : undefined;
      if (risk) {
        if (risk.decision && !decision.ruleIds.includes('OFAC_STOP')) decision = risk.decision;
        await audit(this.options, 'payables', 'bank_change_fraud_check', source, decision, risk.refs, risk.inputs);
      }
      // Record both pieces of phishing evidence even though policy returns the first failure.
      if (bankChanged && decision.kind !== 'ALLOW' && !decision.ruleIds.includes('BANK_CHANGE_HOLD')) {
        decision = { ...decision, ruleIds: [...decision.ruleIds, 'BANK_CHANGE_HOLD'] };
      }
      // An unrelated sender domain cannot be authenticated by a model's vendor ID.
      if (decision.kind === 'ALLOW' && vendor && domain(source.senderDomain) !== domain(vendor.domain)) decision = hold('PAYEE_NOT_IN_MASTER');
      if (decision.kind === 'ALLOW' && !this.payment) decision = hold('INVALID_INPUT');
      const duplicate = decision.ruleIds.includes('DUPLICATE_INVOICE') ? history.find(row =>
        evaluate('payables', { type: 'pay_invoice', invoice: policyInvoice }, { ...context, priorInvoices: [row.policyInvoice] }).ruleIds.includes('DUPLICATE_INVOICE')) ?? prior : undefined;
      const refs = [source.id, fields.invoiceId];
      const evidenceRefs = [...refs, ...(duplicate ? [duplicate.fields.invoiceId] : []), ...(risk?.refs ?? [])];
      const result: SeatResult = { status: 'held', decision, evidenceRefs, paymentRail: this.rail === 'x402' ? X402_LABEL : 'nessie' };
      const row: InvoiceRecord = { source, fields, policyInvoice, fingerprint, result, vendorRevision: vendor?.revision ?? null, paymentAttempted: false };
      await audit(this.options, 'payables', 'pay_invoice', source, decision, evidenceRefs.slice(1), {
        invoiceId: fields.invoiceId, vendorId: fields.vendorId, bankChanged, paymentRail: this.rail === 'x402' ? X402_LABEL : 'nessie',
        senderDomain: domain(source.senderDomain), vendorDomain: vendor?.domain,
        relatedInvoiceId: duplicate?.fields.invoiceId, amountDelta: duplicate ? (fields.amountCents - duplicate.fields.amountCents) / 100 : undefined,
      });
      if (decision.kind !== 'ALLOW') {
        if (decision.kind === 'ESCALATE') result.escalationId = await this.options.controller.request(decision, refs);
        // Conflicting replays never overwrite an original receipt or its fingerprint.
        if (!prior || canReevaluate) await repo.saveInvoice(row);
        return result;
      }
      // Persist reservation BEFORE network I/O. A crash or ambiguous response stays held.
      row.paymentAttempted = true;
      row.result.decision = hold('INVALID_INPUT');
      await repo.saveInvoice(row);
      try {
        const receipt = await this.payment!.payInvoice({ idempotencyKey: `ap:${encodeURIComponent(fields.vendorId)}:${encodeURIComponent(fields.invoiceId)}`,
          invoiceId: fields.invoiceId, vendorId: vendor!.id, amountCents: fields.amountCents,
          sourceAccount: policyInvoice.account, destinationAccountId: vendor!.accountId });
        if (typeof receipt.id === 'string' && receipt.id) result.receiptId = receipt.id;
        if (receipt.status !== 'completed' || typeof receipt.id !== 'string' || !receipt.id) throw new Error('PAYMENT_UNCONFIRMED');
        result.status = 'paid'; result.receiptId = receipt.id; result.decision = decision;
      } catch {
        const uncertain = hold('INVALID_INPUT');
        result.decision = uncertain;
        result.escalationId = await this.options.controller.request(uncertain, refs);
      }
      await repo.saveInvoice(row);
      const completedAction = this.rail === 'x402' ? 'x402_testnet_completed' : 'nessie_completed';
      await audit(this.options, 'payables', result.status === 'paid' ? completedAction : 'payment_uncertain', source,
        result.decision, [fields.invoiceId], { receiptId: result.receiptId, paymentRail: this.rail === 'x402' ? X402_LABEL : 'nessie' });
      return result;
    });
  }
}
