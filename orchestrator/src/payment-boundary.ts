import type { FinanceRepository } from './payables/types';

export type VendorMaster = Pick<FinanceRepository, 'getVendor' | 'hasPendingBankChange' | 'withVendorLock'>;
export class PaymentBoundaryError extends Error {
  constructor() { super('PAYEE_NOT_IN_MASTER'); }
}

/** Server-owned repository only. Callers serialize master writes and payments using
 * FinanceRepository.withVendorLock. Never accept a master snapshot from a task/model.
 * Rebuild the effect payload so raw documents and recipient aliases cannot reach a bank.
 */
export async function masterPayment(input: Record<string, unknown>, master: VendorMaster) {
  input = structuredClone(input);
  const wrapped = 'invoice' in input;
  const allowed = wrapped ? ['invoice', 'sourceText']
    : ['idempotencyKey', 'invoiceId', 'vendorId', 'amountCents', 'sourceAccount', 'destinationAccountId'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new PaymentBoundaryError();
  const invoice = wrapped && input.invoice && typeof input.invoice === 'object'
    ? input.invoice as Record<string, unknown> : input;
  if (wrapped && Object.keys(invoice).some(key => !['id', 'vendorId', 'amountCents', 'lineItems', 'poMatched', 'account'].includes(key))) {
    throw new PaymentBoundaryError();
  }
  const invoiceId = wrapped ? invoice.id : input.invoiceId;
  const vendorId = invoice.vendorId;
  const amountCents = invoice.amountCents;
  const sourceAccount = wrapped ? invoice.account : input.sourceAccount;
  if (typeof invoiceId !== 'string' || !invoiceId || typeof vendorId !== 'string' || !vendorId ||
      !Number.isSafeInteger(amountCents) || Number(amountCents) <= 0 || sourceAccount !== 'operating') throw new PaymentBoundaryError();
  const vendor = await master.getVendor(vendorId);
  if (!vendor || vendor.id !== vendorId || !vendor.approved || vendor.inMaster === false || vendor.ofacHit ||
      typeof vendor.accountId !== 'string' || !vendor.accountId || await master.hasPendingBankChange(vendorId) ||
      (!wrapped && input.destinationAccountId !== vendor.accountId)) throw new PaymentBoundaryError();
  return { invoiceId, vendorId, amountCents: Number(amountCents), sourceAccount, destinationAccountId: vendor.accountId };
}
