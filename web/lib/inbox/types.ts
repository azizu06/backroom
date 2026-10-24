import type { InvoiceFields, SeatResult, VendorFields } from '@backroom/orchestrator';
export interface InboxPreset { id: string; label: string; kind: 'email' | 'invoice'; senderDomain: string; text: string }
export interface InboxReceipt extends SeatResult {
  id: string; scenario_source: 'judge'; seat: 'payables' | 'vendor_onboarding';
  fields: InvoiceFields | VendorFields | null; extractionSource: 'seed' | 'model' | 'unrecognized';
  notice: string; auditId: string; auditHref: string;
  attachment: { name: string; size: number; type: string; sha256: string } | null;
}
