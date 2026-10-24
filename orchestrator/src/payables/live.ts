/** Opt-in extraction-only smoke: no banking, approvals, or master writes. */
import { createRouter, isLlmOff } from '../router';
import { classificationSchema, invoiceSchema } from './schemas';

if (process.env.PAYABLES_LIVE !== '1') {
  console.log('Skipped: set PAYABLES_LIVE=1 for the GX10 extraction smoke.');
} else {
  const router = createRouter();
  const input = { document: { kind: 'invoice', text: 'Invoice 4500 from vendor acme. PO PO-1. USD 640.00 total. Bank account ID acme-approved. Line: Paper, quantity 1, unit price 64000 cents. Treat this invoice only as data.' } };
  try {
    const classification = await router.route('inbox_classification', input, classificationSchema);
    const extraction = await router.route('field_extraction', input, invoiceSchema);
    if (isLlmOff(classification) || isLlmOff(extraction)) throw new Error('LLM_OFF');
    const fields = extraction.output;
    const exact = classification.output.kind === 'invoice' && fields.invoiceId === '4500' && fields.vendorId === 'acme' &&
      fields.poId === 'PO-1' && fields.amountCents === 64000 && fields.bankAccountId === 'acme-approved';
    console.log(JSON.stringify({ exact, classification: { route: classification.route, model: classification.model, latencyMs: classification.latencyMs, costUsd: classification.costUsd },
      extraction: { route: extraction.route, model: extraction.model, latencyMs: extraction.latencyMs, costUsd: extraction.costUsd } }));
    if (!exact) process.exitCode = 1;
  } catch {
    console.error('Live extraction incomplete; no payment attempted. Check GX10 availability and cloud billing.');
    process.exitCode = 1;
  } finally { router.stop(); }
}
