/** Opt-in extraction-only smoke: no banking, approvals, or master writes. */
import { createRouter, isLlmOff } from '../router';
import { northfieldInvoice } from './northfield';
import { classificationSchema, invoiceSchema } from './schemas';

if (process.env.PAYABLES_LIVE !== '1') {
  console.log('Skipped: set PAYABLES_LIVE=1 for the GX10 extraction smoke.');
} else {
  const router = createRouter();
  const expected = northfieldInvoice('4401');
  const input = { document: { kind: 'invoice', text: JSON.stringify(expected) } };
  try {
    const classification = await router.route('inbox_classification', input, classificationSchema);
    const extraction = await router.route('field_extraction', input, invoiceSchema);
    if (isLlmOff(classification) || isLlmOff(extraction)) throw new Error('LLM_OFF');
    const fields = extraction.output;
    const exact = classification.output.kind === 'invoice' && fields.invoiceId === expected.invoiceId && fields.vendorId === expected.vendorId &&
      fields.poId === expected.poId && fields.amountCents === expected.amountCents && fields.bankAccountId === expected.bankAccountId;
    console.log(JSON.stringify({ exact, classification: { route: classification.route, model: classification.model, latencyMs: classification.latencyMs, costUsd: classification.costUsd },
      extraction: { route: extraction.route, model: extraction.model, latencyMs: extraction.latencyMs, costUsd: extraction.costUsd } }));
    if (!exact) process.exitCode = 1;
  } catch {
    console.error('Live extraction incomplete; no payment attempted. Check GX10 availability and cloud billing.');
    process.exitCode = 1;
  } finally { router.stop(); }
}
