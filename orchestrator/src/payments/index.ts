import { paymentMemo, type NessieClient, type PostedDepositsDisplay, type Transaction } from '@backroom/nessie';
import type { InvoiceState, Lease, StateStore } from '../store';

/** Trusted projection of a payment_link and its matching ALLOW audit/plan. Never accept this from HTTP or a model. */
export interface AuthorizedPaymentLink {
  id: string; invoiceId: string; planId: string; auditId: string; policyVersion: number;
  installment: number; amountCents: number; totalCents: number; currency: 'USD';
}
export type PaymentBank = Pick<NessieClient, 'deposit' | 'listDeposits' | 'readBalanceWithPostedDeposits' | 'surfaceCopy'>
  & Partial<Pick<NessieClient, 'readBalanceDisplay'>>;
export interface PaymentRecord {
  linkId: string; invoiceId: string; installment: number; amountCents: number; depositId: string;
  status: 'pending_reconciliation' | 'partially_paid' | 'paid' | 'exception';
}
export interface PaymentException {
  id: string; invoiceId: string; linkId: string; ruleId: string; depositIds: string[];
  followup: 'email' | 'controller_refund_or_credit' | 'controller_review';
  controllerTaskId?: string;
}
export class PaymentError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'PaymentError'; }
}
interface Options {
  bank: PaymentBank; accountId: string;
  lookup(id: string): Promise<AuthorizedPaymentLink | undefined>;
  now?: () => number;
  /** Trusted host schedules/runs reconciliation; errors retain the pending receipt. */
  onPosted?: (linkId: string) => Promise<void>;
}
/** Bank memo for one authorized link. It names the link, so a deposit an earlier link left in the external
 * sandbox (which a company reset does not wipe) never matches; exact amount matching still applies. */
export const paymentLinkMemo = (link: Pick<AuthorizedPaymentLink, 'id' | 'invoiceId' | 'installment'>) =>
  paymentMemo({ invoiceId: link.invoiceId, installment: link.installment, linkId: link.id });
const cents = (amount: number) => Number.isFinite(amount) && Number.isSafeInteger(amount * 100) ? amount * 100 : NaN;

/** Process-local reference queue. Nessie Claims MUST be shared/durable across writers.
 * The host calls reconcile with a valid invoice task lease; HTTP cannot set invoice state.
 */
export class PaymentService {
  private records = new Map<string, PaymentRecord>();
  private issues = new Map<string, PaymentException>();
  private tail: Promise<unknown> = Promise.resolve();
  private retrying?: Promise<{ linkId: string; ok: boolean }[]>;
  constructor(private readonly options: Options) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.tail.then(work); this.tail = run.catch(() => undefined); return run;
  }
  private async link(id: string) {
    const link = await this.options.lookup(id);
    if (!link) throw new PaymentError('PAYMENT_LINK_NOT_FOUND', 404);
    if (link.id !== id || link.currency !== 'USD' || !link.auditId || !link.planId || !link.invoiceId
      || !Number.isSafeInteger(link.amountCents) || link.amountCents <= 0
      || !Number.isSafeInteger(link.totalCents) || link.totalCents < link.amountCents
      || !Number.isSafeInteger(link.installment) || link.installment < 1) throw new PaymentError('ALLOW_REQUIRED');
    return link;
  }
  async view(id: string) {
    const link = await this.link(id);
    return { linkId: link.id, invoiceId: link.invoiceId, installment: link.installment, amountCents: link.amountCents,
      currency: link.currency, payment: structuredClone(this.records.get(id)),
      balance: await (this.options.bank.readBalanceDisplay
        ? this.options.bank.readBalanceDisplay(this.options.accountId)
        : this.options.bank.readBalanceWithPostedDeposits(this.options.accountId)) };
  }
  /** Disclosure for the adapter this service was constructed with. */
  bankDisclosure() { return this.options.bank.surfaceCopy(); }
  async pay(id: string): Promise<PaymentRecord> {
    const posted = await this.serial(async () => {
      const link = await this.link(id);
      const previous = this.records.get(id);
      if (link.amountCents % 100 !== 0) throw new PaymentError('SANDBOX_WHOLE_DOLLARS_REQUIRED');
      if (previous) return structuredClone(previous);
      // The link-scoped memo is Nessie's durable idempotency reference across process restarts; the reducer
      // receipt (invoice/installment) still stops two links from counting the same installment.
      try {
        const deposit = await this.options.bank.deposit({ accountId: this.options.accountId, invoiceId: link.invoiceId,
          installment: link.installment, amountCents: link.amountCents, linkId: link.id });
        const record: PaymentRecord = { linkId: id, invoiceId: link.invoiceId, installment: link.installment,
          amountCents: link.amountCents, depositId: deposit._id, status: 'pending_reconciliation' };
        this.records.set(id, record); return structuredClone(record);
      } catch {
        this.exception(link, 'RECON_DEPOSIT_UNCERTAIN', []);
        throw new PaymentError('DEPOSIT_UNCERTAIN_REVIEW_REQUIRED');
      }
    });
    // Outside the lock: the host job may call reconcile(). Job failures retain the pending receipt.
    if (posted.status === 'pending_reconciliation' && this.options.onPosted) {
      try { await this.options.onPosted(id); } catch { /* The host can retry pendingPayments(). */ }
    }
    return structuredClone(this.records.get(id)!);
  }
  /** Rebuild the process-local view from bank evidence and reducer receipts without writing either. */
  recover(linkIds: readonly string[], store: Pick<StateStore, 'getPayment'>): Promise<{ restored: PaymentRecord[]; skipped: { linkId: string; reason: string }[] }> {
    return this.serial(async () => {
      const feed = await this.options.bank.listDeposits(this.options.accountId);
      const restored: PaymentRecord[] = [];
      const skipped: { linkId: string; reason: string }[] = [];
      for (const linkId of linkIds) {
        if (this.records.has(linkId)) { skipped.push({ linkId, reason: 'ALREADY_TRACKED' }); continue; }
        let link: AuthorizedPaymentLink;
        try { link = await this.link(linkId); }
        catch (error) {
          if (!(error instanceof PaymentError)) throw error;
          skipped.push({ linkId, reason: error.code }); continue;
        }
        const evidence = inspectPaymentEvidence({ linkId, memo: paymentLinkMemo(link), amountCents: link.amountCents }, feed);
        if (evidence.ruleId) {
          skipped.push({ linkId, reason: evidence.ruleId === 'RECON_UNMATCHED' ? 'NOT_POSTED' : evidence.ruleId }); continue;
        }
        const depositId = evidence.deposit!._id;
        const receipt = await store.getPayment(`ar:${link.invoiceId}:${link.installment}`);
        if (receipt && receipt.fingerprint !== `${depositId}:${link.amountCents}`) {
          skipped.push({ linkId, reason: 'RECON_RECEIPT_CONFLICT' }); continue;
        }
        const record: PaymentRecord = { linkId, invoiceId: link.invoiceId, installment: link.installment,
          amountCents: link.amountCents, depositId,
          status: receipt ? receipt.result.invoiceState as 'paid' | 'partially_paid' : 'pending_reconciliation' };
        this.records.set(linkId, record); restored.push(structuredClone(record));
      }
      return { restored, skipped };
    });
  }
  pendingPayments() { return structuredClone([...this.records.values()].filter(row => row.status === 'pending_reconciliation')); }
  retryPending(): Promise<{ linkId: string; ok: boolean }[]> {
    if (this.retrying) return this.retrying;
    const onPosted = this.options.onPosted;
    if (!onPosted) return Promise.resolve([]);
    this.retrying = Promise.resolve().then(async () => {
      const results: { linkId: string; ok: boolean }[] = [];
      for (const row of [...this.records.values()]) {
        if (row.status !== 'pending_reconciliation') continue;
        try { await onPosted(row.linkId); results.push({ linkId: row.linkId, ok: true }); }
        catch { results.push({ linkId: row.linkId, ok: false }); }
      }
      return results;
    }).finally(() => { this.retrying = undefined; });
    return this.retrying;
  }
  exceptions() { return structuredClone([...this.issues.values()]); }
  private exception(link: AuthorizedPaymentLink, ruleId: string, depositIds: string[]) {
    const issue: PaymentException = { id: `${link.id}:${ruleId}`, linkId: link.id, invoiceId: link.invoiceId, ruleId, depositIds,
      followup: ruleId === 'RECON_SHORT' ? 'email' : ruleId === 'RECON_DUPLICATE' ? 'controller_refund_or_credit' : 'controller_review' };
    this.issues.set(issue.id, issue); return issue;
  }
  /** Job entry point. Exact invoice↔payment↔deposit only; no model can approve a fuzzy match.
   * Caller supplies the authoritative current invoice state; reducer CAS rejects stale values.
   */
  reconcile(id: string, store: StateStore, lease: Lease, from: InvoiceState): Promise<PaymentRecord> {
    return this.serial(async () => {
      const link = await this.link(id);
      const record = this.records.get(id);
      if (!record) throw new PaymentError('PAYMENT_NOT_POSTED');
      if (record.status === 'paid' || record.status === 'partially_paid') return structuredClone(record);
      await store.assertLease(lease, this.now());
      const feed = await this.options.bank.listDeposits(this.options.accountId);
      const evidence = inspectPaymentEvidence({ linkId: link.id, memo: paymentLinkMemo(link), amountCents: link.amountCents, depositId: record.depositId }, feed);
      if (evidence.ruleId) {
        const issue = this.exception(link, evidence.ruleId, evidence.depositIds);
        if (issue.followup !== 'email') {
          issue.controllerTaskId = await queueControllerReview(store, lease, issue.id, link.invoiceId,
            evidence.ruleId, evidence.depositIds, link.policyVersion, this.now());
        }
        await this.audit(store, link, evidence.ruleId, { ...issue, stateUnchanged: true });
        record.status = 'exception'; return structuredClone(record);
      }
      // The receipt is stored by invoice/installment, so two links cannot count the same deposit twice.
      const key = `ar:${link.invoiceId}:${link.installment}`;
      const fingerprint = `${record.depositId}:${link.amountCents}`;
      const prior = await store.getPayment(key);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new PaymentError('RECON_RECEIPT_CONFLICT');
        record.status = prior.result.invoiceState as 'paid' | 'partially_paid'; return structuredClone(record);
      }
      // Cumulative amount comes exclusively from earlier reducer receipts, never a balance display or model.
      let paidCents = link.amountCents;
      for (let installment = 1; installment < link.installment; installment++) {
        const receipt = await store.getPayment(`ar:${link.invoiceId}:${installment}`);
        if (!receipt || !Number.isSafeInteger(receipt.result.amountCents)) throw new PaymentError('RECON_PRIOR_INSTALLMENT_REQUIRED');
        paidCents += receipt.result.amountCents as number;
      }
      if (paidCents > link.totalCents) throw new PaymentError('RECON_OVERPAYMENT');
      const invoiceState = paidCents === link.totalCents ? 'paid' : 'partially_paid';
      await store.reservePayment(lease, key, fingerprint, this.now());
      await store.transitionInvoice(lease, link.invoiceId, from, invoiceState, this.now());
      await store.recordPayment(lease, { key, fingerprint, result: { amountCents: link.amountCents, invoiceState, depositId: record.depositId } }, this.now());
      await this.audit(store, link, 'EXACT_PAYMENT_MATCH', { depositId: record.depositId, invoiceState, amountCents: link.amountCents });
      record.status = invoiceState; return structuredClone(record);
    });
  }
  private now() { return (this.options.now ?? Date.now)(); }
  private audit(store: StateStore, link: AuthorizedPaymentLink, rule: string, inputs: Record<string, unknown>) {
    return store.appendAudit({ ts: this.now(), actor: 'code', seat: 'collections', action: 'reconcile', ruleIds: [rule],
      policyVersion: link.policyVersion, refs: [link.invoiceId, link.id, link.auditId], route: 'code', inputs, latencyMs: 0, costUsd: 0 });
  }
}

/** Existing remittances have no pay-link receipt. A trusted expected memo is required;
 * client speech and a matching amount alone cannot clear an already-paid claim.
 */
export function matchRemittance(expected: { amountCents: number; memo: string }, feed: readonly Transaction[]) {
  const matches = feed.filter(row => row.description === expected.memo);
  return matches.length === 1 && matches[0]!.status === 'completed' && matches[0]!.medium === 'balance'
    && cents(matches[0]!.amount) === expected.amountCents ? matches[0] : undefined;
}
export type PaymentView = Awaited<ReturnType<PaymentService['view']>>;
export type { PostedDepositsDisplay };
export { mirrorBankFeed } from './bank-feed';

export type BankEvidence = Transaction & { paymentLinkRef?: string };
/** A trusted imported link reference can identify exceptions; it can never substitute
 * for an exact bank memo when clearing money. Imported seed rows remain synthetic.
 */
export function inspectPaymentEvidence(expected: { linkId: string; amountCents: number; memo: string; depositId?: string }, feed: readonly BankEvidence[]) {
  const matches = feed.filter(row => row.description === expected.memo || row.paymentLinkRef === expected.linkId);
  const deposit = matches[0];
  const ruleId = matches.length > 1 ? 'RECON_DUPLICATE' : !deposit ? 'RECON_UNMATCHED'
    : cents(deposit.amount) < expected.amountCents ? 'RECON_SHORT'
    : deposit.description !== expected.memo ? 'RECON_FUZZY'
    : expected.depositId && deposit._id !== expected.depositId ? 'RECON_REFERENCE_CONFLICT'
    : cents(deposit.amount) !== expected.amountCents || deposit.status !== 'completed' || deposit.medium !== 'balance' ? 'RECON_MISMATCH' : undefined;
  return { ruleId, deposit, depositIds: matches.map(row => row._id) };
}

/** Already-paid job: expectedMemo is a trusted ledger/import reference, never the
 * client's claim. This job creates no deposit. Missing/fuzzy evidence stays open.
 */
export async function reconcileAlreadyPaid(input: { invoiceId: string; totalCents: number; expectedMemo: string; policyVersion: number },
  feed: readonly Transaction[], store: StateStore, lease: Lease, from: InvoiceState, now = Date.now()) {
  await store.assertLease(lease, now);
  const deposit = matchRemittance({ amountCents: input.totalCents, memo: input.expectedMemo }, feed);
  const key = `ar:${input.invoiceId}:1`;
  const prior = await store.getPayment(key);
  if (prior) {
    if (prior.result.invoiceState !== 'paid' || prior.result.amountCents !== input.totalCents) throw new PaymentError('RECON_RECEIPT_CONFLICT');
    return { status: 'paid' as const, depositId: prior.result.depositId as string };
  }
  if (!deposit) {
    const controllerTaskId = await queueControllerReview(store, lease, `claim:${input.invoiceId}:unmatched`,
      input.invoiceId, 'RECON_UNMATCHED', feed.map(row => row._id), input.policyVersion, now);
    await store.appendAudit({ ts: now, actor: 'code', seat: 'collections', action: 'reconcile', ruleIds: ['RECON_UNMATCHED'],
      policyVersion: input.policyVersion, refs: [input.invoiceId], route: 'code',
      inputs: { stateUnchanged: true, followup: 'controller_review', claimRecorded: true, controllerTaskId }, latencyMs: 0, costUsd: 0 });
    return { status: 'exception' as const, ruleId: 'RECON_UNMATCHED' };
  }
  const fingerprint = `${deposit._id}:${input.totalCents}`;
  await store.reservePayment(lease, key, fingerprint, now);
  // Follow the AR reducer graph; there is no direct overdue -> paid mutation.
  if (from === 'overdue') {
    await store.transitionInvoice(lease, input.invoiceId, 'overdue', 'in_collection', now); from = 'in_collection';
  }
  if (from === 'in_collection') {
    await store.transitionInvoice(lease, input.invoiceId, 'in_collection', 'promised', now); from = 'promised';
  }
  await store.transitionInvoice(lease, input.invoiceId, from, 'paid', now);
  await store.recordPayment(lease, { key, fingerprint, result: { depositId: deposit._id, invoiceState: 'paid', amountCents: input.totalCents } }, now);
  await store.appendAudit({ ts: now, actor: 'code', seat: 'collections', action: 'reconcile', ruleIds: ['EXACT_PAYMENT_MATCH'],
    policyVersion: input.policyVersion, refs: [input.invoiceId, deposit._id], route: 'code',
    inputs: { invoiceState: 'paid', alreadyPaidClaim: true }, latencyMs: 0, costUsd: 0 });
  return { status: 'paid' as const, depositId: deposit._id };
}

async function queueControllerReview(store: StateStore, lease: Lease, id: string, invoiceId: string,
  ruleId: string, depositIds: string[], policyVersion: number, now: number) {
  const row = await store.createCallEscalation({ id: `review:${id}`, taskId: lease.id, fromAgent: lease.leaseOwner,
    seat: 'collections', toHuman: 'Dana', invoiceId, ruleIds: [ruleId], evidenceRefs: [invoiceId, ...depositIds],
    policyVersion, quote: { sentenceId: ruleId, text: 'Reconciliation exceptions require controller review; no automatic refund or credit.' } }, now);
  return row.id;
}
