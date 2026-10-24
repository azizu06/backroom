import type { ApprovedVendor, BankChange, FinanceRepository, InvoiceRecord, PurchaseOrder } from './types';

/** Demo/test adapter only. Production uses durable reducers + server-side vendor locks. */
export class MemoryFinanceRepository implements FinanceRepository {
  private vendors = new Map<string, ApprovedVendor>();
  private orders = new Map<string, PurchaseOrder>();
  private invoices = new Map<string, InvoiceRecord>();
  private changes = new Map<string, BankChange>();
  private locks = new Map<string, Promise<void>>();
  constructor(seed: { vendors?: ApprovedVendor[]; purchaseOrders?: PurchaseOrder[] } = {}) {
    for (const vendor of seed.vendors ?? []) this.vendors.set(vendor.id, structuredClone(vendor));
    for (const order of seed.purchaseOrders ?? []) this.orders.set(order.id, structuredClone(order));
  }
  async withVendorLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const next = prior.then(() => new Promise<void>(resolve => { release = resolve; }));
    this.locks.set(id, next);
    await prior;
    // Let the queued promise install its release callback before entering work.
    await Promise.resolve();
    try { return await work(); }
    finally { release(); if (this.locks.get(id) === next) this.locks.delete(id); }
  }
  async getVendor(id: string) { return structuredClone(this.vendors.get(id)); }
  async hasPendingBankChange(vendorId: string) {
    return this.vendors.get(vendorId)?.pendingBankChange === true || [...this.changes.values()].some(row => row.fields.vendorId === vendorId && row.fields.kind === 'bank_change' && ['held', 'awaiting_controller'].includes(row.result.status));
  }
  async saveVendor(vendor: ApprovedVendor) { this.vendors.set(vendor.id, structuredClone(vendor)); }
  async getPO(id: string) { return structuredClone(this.orders.get(id)); }
  async listInvoices(vendorId: string) { return structuredClone([...this.invoices.values()].filter(row => row.fields.vendorId === vendorId)); }
  async getInvoice(vendorId: string, id: string) { return structuredClone(this.invoices.get(JSON.stringify([vendorId, id]))); }
  async saveInvoice(row: InvoiceRecord) { this.invoices.set(JSON.stringify([row.fields.vendorId, row.fields.invoiceId]), structuredClone(row)); }
  async getBankChange(id: string) { return structuredClone(this.changes.get(id)); }
  async saveBankChange(row: BankChange) { this.changes.set(row.id, structuredClone(row)); }
  async commitApprovedChange(change: BankChange, vendor: ApprovedVendor) {
    const stored = this.changes.get(change.id);
    if (!stored || JSON.stringify(stored.fields) !== JSON.stringify(change.fields) ||
        stored.result.escalationId !== change.result.escalationId ||
        (this.vendors.get(vendor.id)?.revision ?? null) !== change.baselineRevision) throw new Error('STALE_BANK_CHANGE');
    this.vendors.set(vendor.id, { ...structuredClone(vendor), pendingBankChange: false, inMaster: true });
    this.changes.set(change.id, structuredClone(change));
  }
}
