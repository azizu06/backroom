import { createBankChangeRiskCheck, assessBankChangeRisk } from '../vendor/crs';
import { x402Payables, X402_LABEL, type X402Label } from '../x402';
import { createHash } from 'node:crypto';
import { evaluate, type APInvoice, type Context, type Decision, type LineItem, type RuleId } from '@backroom/policy';
import { audit, domain, hold } from './decisions';
import { invoiceSchema, sourceSchema } from './schemas';
import type { FinanceRepository, InboxSource, InvoiceFields, InvoiceRecord, PayablesClient, SeatOptions, SeatResult } from './types';
export type * from './types';
export { MemoryFinanceRepository } from './repository';
export { controllerForLease } from './decisions';
export * from './northfield';
export { nessieDebitPayables, nessiePayables } from './payments';

function items(lines: readonly LineItem[]) {
  return JSON.stringify(lines.map(item => [item.description.trim().toLowerCase().replace(/\s+/g, ' '), item.quantity, item.unitPriceCents])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
const CONTROLLER_OVERRIDABLE = new Set<RuleId>(['NO_PO', 'OVER_LIMIT']);
const sameRules = (left: readonly string[], right: readonly string[]) =>
  [...left].sort().join('\n') === [...right].sort().join('\n');
export class PayablesSeat {
  private readonly payment?: PayablesClient;
  private readonly rail: 'nessie' | 'x402';
  private readonly label: 'nessie' | X402Label;
  /** Server-selected rail; role tools cannot change it. */
  get paymentRail() { return this.label; }
  /** `x402Label` only names an injected client's rail in results and audits. */
  constructor(private readonly options: SeatOptions & { nessie?: PayablesClient; x402?: PayablesClient; paymentRail?: string; x402Label?: X402Label }) {
    const rail = options.paymentRail ?? process.env.PAYMENT_RAIL ?? 'nessie';
    if (rail !== 'nessie' && rail !== 'x402') throw new Error('UNKNOWN_PAYMENT_RAIL');
    this.rail = rail;
    if (options.x402Label && options.x402Label !== X402_LABEL && (rail !== 'x402' || !options.x402)) throw new Error('X402_SIMULATION_NEEDS_CLIENT');
    this.label = rail === 'x402' ? options.x402Label ?? X402_LABEL : 'nessie';
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
  /** `effect.fence` is the caller's synchronous ownership check. It runs immediately before the
   * reservation write and immediately before the provider call, with no await in between. */
  async process(unchecked: InvoiceFields, envelope: InboxSource, effect: { fence?(): void } = {}): Promise<SeatResult> {
    const fields = invoiceSchema.parse(unchecked), source = sourceSchema.parse(envelope);
    const repo = this.options.repository;
    return repo.withVendorLock(`vendor:${fields.vendorId}`, async () => {
      const fingerprint = createHash('sha256').update(JSON.stringify(fields)).digest('hex');
      const prior = await repo.getInvoice(fields.vendorId, fields.invoiceId);
      const vendor = await repo.getVendor(fields.vendorId);
      if (prior?.fingerprint === fingerprint && prior.paymentAttempted) {
        await audit(this.options, 'payables', 'pay_invoice_replay', source, prior.result.decision, [fields.invoiceId],
          { paymentRail: this.label, receiptId: prior.result.receiptId });
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
      let approvedEscalation: Awaited<ReturnType<SeatOptions['state']['getEscalation']>>;
      if (decision.kind === 'ESCALATE' && prior?.fingerprint === fingerprint && !prior.paymentAttempted && prior.result.escalationId &&
          decision.ruleIds.length > 0 && decision.ruleIds.every(rule => CONTROLLER_OVERRIDABLE.has(rule))) {
        const now = (this.options.now ?? Date.now)();
        await this.options.state.expireEscalations(now);
        const approval = await this.options.state.getEscalation(prior.result.escalationId);
        const evidenceSource = prior.source?.id ?? source.id;
        const bound = approval?.id === prior.result.escalationId && approval.status === 'approved' &&
          approval.toHuman === decision.toHuman && approval.policyVersion === decision.policyVersion &&
          approval.evidenceRefs.includes(evidenceSource) && approval.evidenceRefs.includes(fields.invoiceId) &&
          sameRules(approval.ruleIds, decision.ruleIds);
        const passkey = approval?.method === 'passkey' && typeof approval.credentialId === 'string' && !!approval.credentialId &&
          typeof approval.decidedAt === 'number' && Number.isFinite(approval.decidedAt) &&
          approval.decidedAt >= approval.createdAt && approval.decidedAt < approval.expiresAt && approval.decision?.kind === 'Approve';
        if (bound && passkey) {
          approvedEscalation = approval;
          decision = { kind: 'ALLOW', ruleIds: [...decision.ruleIds], policyVersion: decision.policyVersion };
        }
      }
      if (decision.kind === 'ALLOW' && !this.payment) decision = hold('INVALID_INPUT');
      const duplicate = decision.ruleIds.includes('DUPLICATE_INVOICE') ? history.find(row =>
        evaluate('payables', { type: 'pay_invoice', invoice: policyInvoice }, { ...context, priorInvoices: [row.policyInvoice] }).ruleIds.includes('DUPLICATE_INVOICE')) ?? prior : undefined;
      const refs = [source.id, fields.invoiceId];
      const evidenceRefs = [...refs, ...(duplicate ? [duplicate.fields.invoiceId] : []), ...(risk?.refs ?? [])];
      const result: SeatResult = { status: 'held', decision, evidenceRefs, paymentRail: this.label };
      const row: InvoiceRecord = { source, fields, policyInvoice, fingerprint, result, vendorRevision: vendor?.revision ?? null, paymentAttempted: false };
      await audit(this.options, 'payables', 'pay_invoice', source, decision, evidenceRefs.slice(1), {
        invoiceId: fields.invoiceId, vendorId: fields.vendorId, bankChanged, paymentRail: this.label,
        fence: effect.fence ? 'checked' : 'not_applicable',
        senderDomain: domain(source.senderDomain), vendorDomain: vendor?.domain,
        relatedInvoiceId: duplicate?.fields.invoiceId, amountDelta: duplicate ? (fields.amountCents - duplicate.fields.amountCents) / 100 : undefined,
      });
      if (approvedEscalation && decision.kind === 'ALLOW') {
        await this.options.state.appendAudit({ ts: (this.options.now ?? Date.now)(), actor: 'human', seat: 'payables',
          action: 'pay_invoice_approval_applied', decision: 'ALLOW', ruleIds: [...approvedEscalation.ruleIds],
          policyVersion: approvedEscalation.policyVersion, refs: [source.id, fields.invoiceId, approvedEscalation.id],
          route: 'passkey', latencyMs: 0, costUsd: 0,
          inputs: { method: approvedEscalation.method, credentialId: approvedEscalation.credentialId,
            escalationId: approvedEscalation.id, controllerDecision: approvedEscalation.status } });
      }
      if (decision.kind !== 'ALLOW') {
        if (decision.kind === 'ESCALATE') result.escalationId = prior?.fingerprint === fingerprint && prior.result.escalationId
          ? prior.result.escalationId : await this.options.controller.request(decision, refs);
        // Conflicting replays never overwrite an original receipt or its fingerprint.
        if (!prior || canReevaluate) await repo.saveInvoice(row);
        return result;
      }
      const fenced = async (stage: 'reservation' | 'provider', error: unknown) => {
        await audit(this.options, 'payables', 'payment_fenced', source, hold('INVALID_INPUT'), [fields.invoiceId],
          { stage, error: error instanceof Error ? error.message.slice(0, 80) : 'FENCED', paymentRail: this.label });
        return error;
      };
      const stale = () => { try { effect.fence?.(); return undefined; } catch (error) { return error ?? new Error('FENCED'); } };
      let fence = stale();
      if (fence) throw await fenced('reservation', fence);
      // Persist reservation BEFORE network I/O. A crash or ambiguous response stays held.
      row.paymentAttempted = true;
      row.result.decision = hold('INVALID_INPUT');
      await repo.saveInvoice(row);
      fence = stale();
      if (fence) {
        // Fenced under the vendor lock before any provider request: no debit can exist, so release it.
        row.paymentAttempted = false;
        await repo.saveInvoice(row);
        throw await fenced('provider', fence);
      }
      try {
        // No await between the fence above and starting this request.
        const receipt = await this.payment!.payInvoice({ idempotencyKey: `ap:${encodeURIComponent(fields.vendorId)}:${encodeURIComponent(fields.invoiceId)}`,
          invoiceId: fields.invoiceId, vendorId: vendor!.id, amountCents: fields.amountCents,
          sourceAccount: policyInvoice.account, destinationAccountId: vendor!.accountId });
        if (typeof receipt.id === 'string' && receipt.id) result.receiptId = receipt.id;
        if (receipt.status !== 'completed' || typeof receipt.id !== 'string' || !receipt.id) throw new Error('PAYMENT_UNCONFIRMED');
        if (receipt.reconciliation) {
          result.reconciliation = receipt.reconciliation;
          const exact = receipt.reconciliation.match === 'EXACT';
          await this.options.state.appendAudit({ ts: (this.options.now ?? Date.now)(), actor: 'code', seat: 'payables', action: 'reconcile',
            decision: exact ? 'ALLOW' : 'ESCALATE', ruleIds: [exact ? 'EXACT_PAYMENT_MATCH' : 'RECON_MISMATCH'],
            policyVersion: decision.policyVersion, refs: [source.id, fields.invoiceId, receipt.id], route: 'code', latencyMs: 0, costUsd: 0,
            inputs: { transactionKind: 'withdrawal', match: receipt.reconciliation.match, debitId: receipt.reconciliation.debitId,
              transactionId: receipt.reconciliation.transactionId, invoiceId: fields.invoiceId, vendorId: fields.vendorId, amountCents: fields.amountCents,
              reason: receipt.reconciliation.reason } });
          if (!exact) throw new Error('NESSIE_DEBIT_RECONCILIATION_MISMATCH');
        }
        result.status = 'paid'; result.receiptId = receipt.id; result.decision = decision;
      } catch {
        const uncertain = hold('INVALID_INPUT');
        result.decision = uncertain;
        result.escalationId = await this.options.controller.request(uncertain, refs);
      }
      await repo.saveInvoice(row);
      const completedAction = `${this.label.replace(' ', '_')}_completed`;
      await audit(this.options, 'payables', result.status === 'paid' ? completedAction : 'payment_uncertain', source,
        result.decision, [fields.invoiceId], { receiptId: result.receiptId, paymentRail: this.label });
      return result;
    });
  }
}
