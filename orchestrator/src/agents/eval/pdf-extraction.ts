/** Source/PDF extraction accuracy: the text layer of each fixture invoice PDF through the production
 * router's local `field_extraction` route on GX10 (gpt-oss:20b). A recorded live run, not part of the
 * deterministic mock scoreboard: the scoreboard only reads the committed result file. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { northfield, northfieldInvoice } from '../../payables';
import { createRouter, isLlmOff, type OutputSchema } from '../../router';
import { MemoryStateStore } from '../../store';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
export const PDF_RESULT_PATH = 'docs/eval/pdf-extraction.json';
export const GX10_ORIGIN = 'http://100.117.44.20:11434';
/** Printed on the document. vendorId and bankAccountId are not printed; code resolves them from the vendor master. */
export const PDF_FIELDS = ['vendorName', 'invoiceId', 'poId', 'amountCents', 'currency', 'lineItems', 'adjustmentCents'] as const;
type Candidate = Partial<Record<typeof PDF_FIELDS[number], unknown>>;

const line = { type: 'object', additionalProperties: false, required: ['description', 'quantity', 'unitPriceCents'],
  properties: { description: { type: 'string' }, quantity: { type: 'integer', minimum: 1 }, unitPriceCents: { type: 'integer', minimum: 0 } } };
export const PDF_SCHEMA: OutputSchema<Candidate> = {
  jsonSchema: { type: 'object', additionalProperties: false, required: ['vendorName', 'invoiceId', 'poId', 'amountCents', 'currency', 'lineItems'],
    properties: { vendorName: { type: 'string' }, invoiceId: { type: 'string', description: 'Digits only, without #' },
      poId: { type: ['string', 'null'] }, amountCents: { type: 'integer', description: 'Total due in cents' },
      currency: { type: 'string' }, lineItems: { type: 'array', items: line },
      adjustmentCents: { type: 'integer', minimum: 0, description: 'Only if the document shows an adjustment' } } },
  parse(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_CANDIDATE');
    return value as Candidate;
  },
};

/** The trusted fields a perfect reader would print-match, from the frozen seed. */
export function expectedFields(id: string): Candidate {
  const invoice = northfieldInvoice(id);
  const vendor = northfield.vendors.find(row => row.id === invoice.vendorId)!;
  return { vendorName: vendor.name, invoiceId: invoice.invoiceId, poId: invoice.poId, amountCents: invoice.amountCents, currency: invoice.currency,
    lineItems: invoice.lineItems, adjustmentCents: invoice.adjustmentCents };
}
const norm = (name: string, value: unknown) => {
  if (name === 'vendorName' && typeof value === 'string') return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (name === 'invoiceId' && typeof value === 'string') return value.replace(/^#/, '').trim();
  if (name === 'lineItems' && Array.isArray(value)) return value.map(row => [String(row?.description ?? '').trim().toLowerCase().replace(/\s+/g, ' '), row?.quantity, row?.unitPriceCents]);
  if (name === 'adjustmentCents' && (value === 0 || value === null)) return undefined;
  return value ?? undefined;
};
/** Exact match per field after cosmetic normalisation (case/punctuation of names, '#', whitespace). */
export function scoreFields(actual: Candidate | undefined, expected: Candidate) {
  // No candidate (gate refused or no local answer) scores zero, including the optional adjustment.
  if (!actual) return { correct: 0, total: PDF_FIELDS.length, mismatches: [...PDF_FIELDS] as string[] };
  const mismatches: string[] = PDF_FIELDS.filter(name => JSON.stringify(norm(name, actual?.[name])) !== JSON.stringify(norm(name, expected[name])));
  return { correct: PDF_FIELDS.length - mismatches.length, total: PDF_FIELDS.length, mismatches };
}
export function pdfInvoiceIds() {
  return northfield.apInvoices.filter(row => row.rawRef.endsWith('.pdf')).map(row => row.id);
}
async function pdfText(bytes: Uint8Array) {
  const { PDFiumLibrary } = await import('@hyzyla/pdfium');
  const library = await PDFiumLibrary.init();
  try {
    const doc = await library.loadDocument(bytes);
    try { return [...doc.pages()].map(page => page.getText()).join('\n'); } finally { doc.destroy(); }
  } finally { library.destroy(); }
}

/** GX10 only: any other host (including a cloud fallback) is refused before a request is made. */
export async function runPdfExtraction(options: { fetch?: typeof fetch; ids?: string[]; model?: string } = {}) {
  const http = options.fetch ?? fetch;
  const model = options.model ?? 'gpt-oss:20b';
  const failures: Record<string, string> = {};
  let current = '';
  // A fresh router per document: one slow answer must not demote GX10 for the rest of the measurement.
  // How often production limits would have demoted or timed out is reported separately below.
  const router = () => createRouter({ stateStore: new MemoryStateStore(), localBaseUrl: `${GX10_ORIGIN}/v1`, localModel: model, localEnabled: true,
    cloudProvider: 'anthropic', anthropicApiKey: '', timeoutMs: 60000,
    onFailure: failure => { failures[current] ??= `${failure.route}:${failure.kind}`; },
    fetch: async (url, init) => {
      if (!String(url).startsWith(`${GX10_ORIGIN}/`)) throw new Error('NON_GX10_REQUEST_REFUSED');
      return http(url, init);
    } });
  const items: ({ id: string; route: string | null; latencyMs: number; correct: number; total: number; mismatches: string[]; error?: string; failure?: string | null })[] = [];
  for (const id of options.ids ?? pdfInvoiceIds()) {
    current = id;
    const row = northfield.apInvoices.find(invoice => invoice.id === id)!;
    const text = await pdfText(readFileSync(join(root, 'fixtures', row.rawRef)));
    const started = performance.now();
    let candidate: Candidate | undefined, error: string | undefined, route: string | undefined;
    try {
      const result = await router().route('field_extraction', text, PDF_SCHEMA);
      if (isLlmOff(result)) error = 'LLM_OFF';
      else { candidate = result.output; route = result.route; }
    } catch { error = 'NO_LOCAL_RESULT_CLOUD_REFUSED'; }
    const score = scoreFields(candidate, expectedFields(id));
    items.push({ id, route: route ?? null, latencyMs: Math.round(performance.now() - started), ...score,
      ...(error && { error, failure: failures[id] ?? null }) });
  }
  const correct = items.reduce((sum, row) => sum + row.correct, 0), total = items.reduce((sum, row) => sum + row.total, 0);
  const latencies = items.map(row => row.latencyMs).sort((a, b) => a - b);
  const byField = Object.fromEntries(PDF_FIELDS.map(name => [name, items.filter(row => !row.mismatches.includes(name)).length]));
  return { model, items: items.length, fieldsCorrect: correct, fieldsTotal: total, percent: total ? Number((100 * correct / total).toFixed(2)) : null,
    exactItems: items.filter(row => row.correct === row.total).length, errors: items.filter(row => 'error' in row).length,
    p50LatencyMs: latencies[Math.floor(latencies.length / 2)] ?? null,
    /** Production router defaults: 8 s local text timeout; GX10 is demoted when the median exceeds 5 s. */
    overProductionTimeout8s: items.filter(row => row.latencyMs > 8000).length,
    overDemotionMedian5s: items.filter(row => row.latencyMs > 5000).length, byField, results: items };
}

// `pnpm --filter @backroom/orchestrator exec tsx src/agents/eval/pdf-extraction.ts` records a live GX10 run.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const run = await runPdfExtraction();
  const record = { schemaVersion: 1, mode: 'recorded-live-gx10', recordedAt: new Date().toISOString(),
    command: 'pnpm --filter @backroom/orchestrator exec tsx src/agents/eval/pdf-extraction.ts',
    baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    scope: `Text layer of ${run.items} fixture invoice PDFs (pdfium) through the production router local field_extraction route on shared GX10 ${run.model}, production 0.7 confidence gate, cloud fallback refused, a fresh router per document with a 60 s timeout (production uses 8 s and demotes GX10 above a 5 s median; counts reported). Scored ${PDF_FIELDS.length} document-printed fields per invoice by exact match after cosmetic normalisation; vendorId and bankAccountId are not printed and are resolved by code from the vendor master. Image/vision reading is not measured.`,
    ...run };
  writeFileSync(join(root, PDF_RESULT_PATH), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ ...run, results: undefined }, null, 2));
  process.exit(0);
}
