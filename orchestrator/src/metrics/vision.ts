import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MemoryStateStore, type AuditEntry } from '../store';
import { createNorthfieldRepository, northfieldVendor, PayablesSeat, type InvoiceFields } from '../payables';
import { processInbox } from '../payables/inbox';
import { isLlmOff, type route, type RouteResult } from '../router';
import { percentile } from './report';

export const visionRoot = fileURLToPath(new URL('../../../', import.meta.url));
export interface VisionCase {
  id: string; file: string; mediaType: string; sha256: string; senderDomain: string;
  expected: InvoiceFields; expectedRule: string; trap: boolean;
}
export interface VisionSample {
  id: string; trap: boolean; expectedRule: string; fields: InvoiceFields | null; fieldMatches: Record<string, boolean>; exact: boolean;
  status: string; ruleIds: string[]; ruleMatch: boolean; elapsedMs: number;
  extraction: Omit<RouteResult, 'output'> | null; audit: AuditEntry[]; mockPayments: number;
}
export interface VisionReceipt {
  version: 1; complete: boolean; expectedSamples: number; measuredAt: string; sourceSha: string; host: string; model: string; scope: string;
  hashes: Record<string, string>; samples: VisionSample[];
}
export function visionCases(): VisionCase[] {
  return JSON.parse(readFileSync(`${visionRoot}/fixtures/vision/manifest.json`, 'utf8'));
}
/** Real rendering and policy, live/injected extraction. Effects always simulated. */
export async function runVisionCase(c: VisionCase, modelRoute: typeof route): Promise<VisionSample> {
  const bytes = readFileSync(`${visionRoot}/fixtures/vision/${c.file}`);
  if (createHash('sha256').update(bytes).digest('hex') !== c.sha256) throw new Error('VISION_FIXTURE_CHANGED');
  const repository = await createNorthfieldRepository();
  if (c.expectedRule === 'DUPLICATE_INVOICE') await repository.saveVendor({ ...northfieldVendor('acme'), pendingBankChange: false });
  const state = new MemoryStateStore();
  let fields: InvoiceFields | null = null, extraction: VisionSample['extraction'] = null, mockPayments = 0;
  const controller = { request: async () => `simulated-review:${c.id}` };
  const payables = new PayablesSeat({ state, repository, controller, nessie: { payInvoice: async () => { mockPayments++; return { id: `FAKE:${c.id}`, status: 'completed' }; } } });
  const tracking: typeof route = async (task, input, schema) => {
    const result = await modelRoute(task, input, schema);
    if (!isLlmOff(result)) extraction = { route: result.route, model: result.model, costUsd: result.costUsd, latencyMs: result.latencyMs };
    return result;
  };
  const start = performance.now();
  const result = await processInbox({ id: c.id, source: 'judge', kind: 'invoice', text: '', senderDomain: c.senderDomain, attachment: { mediaType: c.mediaType, bytes } }, {
    state, controller, modelRoute: tracking,
    payables: { process: async (value, source) => { fields = value; return payables.process(value, source); } },
    vendor: { propose: async () => { throw new Error('UNEXPECTED_VENDOR_DISPATCH'); } },
  });
  const elapsedMs = performance.now() - start;
  const fieldMatches = Object.fromEntries(Object.entries(c.expected).map(([key, value]) => [key,
    JSON.stringify(key === 'adjustmentCents' && fields ? (fields as InvoiceFields)[key] ?? 0 : fields?.[key as keyof InvoiceFields]) === JSON.stringify(value)]));
  return { id: c.id, trap: c.trap, expectedRule: c.expectedRule, fields, fieldMatches, exact: Object.values(fieldMatches).every(Boolean), status: result.status,
    ruleIds: result.decision.ruleIds, ruleMatch: result.decision.ruleIds.some(rule => rule === c.expectedRule), elapsedMs,
    extraction, audit: await state.listAudit(), mockPayments };
}
export function visionMetricRow(receipt: VisionReceipt): [string, string, string] {
  const samples = receipt.samples;
  if (!receipt.complete || !samples.length || samples.length !== receipt.expectedSamples) throw new Error('INCOMPLETE_VISION_RECEIPT');
  const traps = samples.filter(sample => sample.trap), clean = samples.filter(sample => !sample.trap);
  const fields = samples.flatMap(sample => Object.values(sample.fieldMatches));
  const times = samples.map(sample => sample.elapsedMs);
  return ['GX10 invoice vision (live local model; simulated effects)',
    `${samples.filter(sample => sample.exact).length}/${samples.length} exact; ${fields.filter(Boolean).length}/${fields.length} fields; p50 ${percentile(times, .5)?.toFixed(2)} ms / p95 ${percentile(times, .95)?.toFixed(2)} ms`,
    `Recorded ${receipt.measuredAt}; ${receipt.model}; ${samples.filter(sample => sample.ruleMatch).length}/${samples.length} expected code rules; ${traps.filter(sample => sample.status === 'held').length}/${traps.length} traps held; ${clean.filter(sample => sample.status === 'held').length}/${clean.length} clean false holds. Includes render/retries/failures, no warmup removal. [Receipt](evidence/gx10-vision/receipt.json); [limits](evidence/gx10-vision/README.md). Small synthetic sample; no real transfer or population-accuracy claim.`];
}
