/** Frozen synthetic company adapter. These references are NOT provisioned Nessie IDs.
 * Only server-owned fixture/master data may enter this adapter; never request fields.
 */
import { createHash } from 'node:crypto';
import seed from '../../../fixtures/company/northfield.json';
import { MemoryFinanceRepository } from './repository';
import { invoiceSchema } from './schemas';
import type { ApprovedVendor, InboxSource, InvoiceFields, VendorFields } from './types';

export { seed as northfield };
export function northfieldVendor(id: string): ApprovedVendor {
  const vendor = seed.vendors.find(row => row.id === id);
  if (!vendor) throw new Error('SEED_VENDOR_NOT_FOUND');
  return { id, domain: vendor.knownDomain, accountId: vendor.approvedBankRef,
    inMaster: vendor.inMaster, approved: vendor.approved, revision: 1, pendingBankChange: vendor.pendingBankChange,
    ofacHit: seed.signals.some(signal => signal.vendorId === id && signal.type === 'ofac_hit' && signal.value) };
}
export function northfieldInvoice(id: string): InvoiceFields {
  const invoice = seed.apInvoices.find(row => row.id === id);
  if (!invoice) throw new Error('SEED_INVOICE_NOT_FOUND');
  const vendor = northfieldVendor(invoice.vendorId);
  const change = seed.bankChanges.find(row => row.invoiceId === id);
  return invoiceSchema.parse({ kind: 'invoice', invoiceId: id, vendorId: invoice.vendorId,
    poId: invoice.poId, amountCents: invoice.amountCents, currency: 'USD', lineItems: invoice.lineItems,
    ...(invoice.adjustmentCents !== 0 && { adjustmentCents: invoice.adjustmentCents }),
    bankAccountId: change?.proposedBankRef ?? vendor.accountId });
}
export function northfieldSource(id: string): InboxSource {
  const invoice = seed.apInvoices.find(row => row.id === id);
  if (!invoice) throw new Error('SEED_INVOICE_NOT_FOUND');
  return { id: `seed-inbox:${id}`, source: 'seed',
    senderDomain: seed.bankChanges.find(row => row.invoiceId === id)?.senderDomain ?? northfieldVendor(invoice.vendorId).domain };
}
export function northfieldChange(id: string): { fields: VendorFields; source: InboxSource } {
  const change = seed.bankChanges.find(row => row.id === id);
  if (!change) throw new Error('SEED_CHANGE_NOT_FOUND');
  return { fields: { kind: 'bank_change', vendorId: change.vendorId,
    domain: northfieldVendor(change.vendorId).domain, bankAccountId: change.proposedBankRef },
    source: { id, source: 'seed', senderDomain: change.senderDomain } };
}
export async function createNorthfieldRepository() {
  const repository = new MemoryFinanceRepository({ vendors: seed.vendors.map(vendor => northfieldVendor(vendor.id)),
    purchaseOrders: seed.purchaseOrders });
  // Historical paid invoices are duplicate evidence/reservations, never replayed as new debits.
  for (const invoice of seed.apInvoices.filter(row => row.status === 'paid')) {
    const fields = northfieldInvoice(invoice.id);
    await repository.saveInvoice({ fields, policyInvoice: { id: invoice.id, vendorId: invoice.vendorId,
      amountCents: invoice.amountCents, lineItems: invoice.lineItems, poMatched: invoice.poMatched, account: invoice.account },
      fingerprint: createHash('sha256').update(JSON.stringify(fields)).digest('hex'), vendorRevision: 1,
      paymentAttempted: true, result: { status: 'paid', decision: { kind: 'ALLOW', ruleIds: ['IN_BADGE'], policyVersion: seed.policyVersion },
        evidenceRefs: [invoice.rawRef, invoice.emailRef] } });
  }
  return repository;
}
