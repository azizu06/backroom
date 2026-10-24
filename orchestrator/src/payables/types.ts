import type { APInvoice, Decision, LineItem } from '@backroom/policy';
import type { BankChangeRisk } from '../vendor/crs';
import type { StateStore } from '../store';

export interface InboxSource { id: string; source: 'seed' | 'judge'; senderDomain: string }
/** senderDomain comes from trusted envelope metadata, never extraction output. */
export interface FinanceInboxItem extends InboxSource { kind: 'email' | 'invoice'; text: string }
export interface InvoiceFields {
  kind: 'invoice'; invoiceId: string; vendorId: string; poId: string | null;
  amountCents: number; adjustmentCents?: number; currency: 'USD'; bankAccountId: string; lineItems: LineItem[];
}
export interface VendorFields {
  kind: 'bank_change' | 'vendor'; vendorId: string; domain: string; bankAccountId: string;
}
export interface ApprovedVendor {
  id: string; domain: string; accountId: string; approved: boolean; revision: number;
  ofacHit?: boolean; inMaster?: boolean; pendingBankChange?: boolean;
}
export interface PurchaseOrder { id: string; vendorId: string; amountCents: number; lineItems: LineItem[] }
export interface SeatResult {
  status: 'paid' | 'held' | 'rejected' | 'awaiting_controller' | 'approved';
  decision: Decision; escalationId?: string; receiptId?: string; evidenceRefs: string[];
}
export interface InvoiceRecord { fields: InvoiceFields; policyInvoice: APInvoice; result: SeatResult; fingerprint: string; vendorRevision: number | null; paymentAttempted: boolean }
export interface BankChange {
  id: string; fields: VendorFields; source: InboxSource; baselineRevision: number | null;
  verified: boolean; result: SeatResult;
}
/** Durable implementations must serialize ALL master writes and payments for the vendor,
 * and persist held payment claims before attempting a network write. Never retry an
 * uncertain payment without the bank's durable idempotency/reconciliation support.
 */
export interface FinanceRepository {
  withVendorLock<T>(lockKey: string, work: () => Promise<T>): Promise<T>;
  getVendor(id: string): Promise<ApprovedVendor | undefined>;
  hasPendingBankChange(vendorId: string): Promise<boolean>;
  saveVendor(vendor: ApprovedVendor): Promise<void>;
  getPO(id: string): Promise<PurchaseOrder | undefined>;
  listInvoices(vendorId: string): Promise<InvoiceRecord[]>;
  getInvoice(vendorId: string, invoiceId: string): Promise<InvoiceRecord | undefined>;
  saveInvoice(invoice: InvoiceRecord): Promise<void>;
  getBankChange(id: string): Promise<BankChange | undefined>;
  saveBankChange(change: BankChange): Promise<void>;
  /** Atomically compare baselineRevision, update master, and mark the immutable proposal approved. */
  commitApprovedChange(change: BankChange, vendor: ApprovedVendor): Promise<void>;
}
export interface PayablesClient {
  payInvoice(input: {
    idempotencyKey: string; invoiceId: string; vendorId: string; amountCents: number;
    sourceAccount: string; destinationAccountId: string;
  }): Promise<{ id: string; status: 'completed' | 'pending' }>;
}
/** Request-only binding to StateStore.createEscalation. Decisions are written only
 * by the shared ControllerApprovals service and read directly from StateStore. */
export interface ControllerPort {
  request(decision: Extract<Decision, { kind: 'ESCALATE' }>, evidenceRefs: string[]): Promise<string>;
}
export interface SeatOptions {
  repository: FinanceRepository; state: Pick<StateStore, 'appendAudit' | 'getEscalation' | 'expireEscalations'>;
  bankChangeRisk?: BankChangeRisk;
  controller: ControllerPort; now?: () => number;
}
