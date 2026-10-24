import { invoiceSchema } from './schemas';
import type { InvoiceFields } from './types';

/** Narrow deterministic fallback for a complete attachment transcription. This parses data,
 * not prose claims about approval, PO matching or payment authority. All fields
 * still pass the invoice schema and the normal PayablesSeat policy/master checks.
 */
export function structuredInvoice(text: string): InvoiceFields | undefined {
  const lines = text.split('\n').filter(line => line.startsWith('Invoice #'));
  if (lines.length !== 1) return;
  const match = /^Invoice #([\w:/.-]+)\. Vendor ID: ([\w:/.-]+)\. PO: ([\w:/.-]+)\. Currency: USD\. Total cents: (\d+)\. Bank account reference: ([\w:/.-]+)\. Line items: (\[.*\])\. Adjustment cents: (\d+)\.$/.exec(lines[0]!);
  if (!match) return;
  try {
    return invoiceSchema.parse({ kind: 'invoice', invoiceId: match[1], vendorId: match[2], poId: match[3] === 'none' ? null : match[3],
      currency: 'USD', amountCents: Number(match[4]), bankAccountId: match[5], lineItems: JSON.parse(match[6]!), adjustmentCents: Number(match[7]) });
  } catch { return; }
}
