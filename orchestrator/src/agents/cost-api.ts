import { timingSafeEqual } from 'node:crypto';
import { getStateStore } from '../runtime';
import type { AuditEntry, StateStore } from '../store';
import { demoCostRecords } from './usage-demo';
import { readActivationUsage, readAuditUsage, readCaseUsage, summarizeUsage, type ActivationUsage, type CostRecord } from './usage-reader';

/** Read-only adapter. Only server-owned IDs assign costs to invoices/runs.
 * The runtime may supply its persisted cumulative snapshots without modifying usage.ts.
 */
export function createRecordedCostReader(options: {
  store?: () => StateStore;
  activations?: () => Promise<readonly ActivationUsage[]>;
  cases?: () => Promise<readonly { result: import('./dispatcher').CaseResult; invoiceId: string | null }[]>;
  linkAudit?: (entry: AuditEntry) => { runId: string; invoiceId: string | null };
} = {}) {
  return async (): Promise<CostRecord[]> => {
    const store = (options.store ?? getStateStore)();
    const [entries, activations, cases] = await Promise.all([store.listAudit(), options.activations?.() ?? [], options.cases?.() ?? []]);
    const link = options.linkAudit ?? ((entry: AuditEntry) => {
      const run = entry.inputs?.runId ?? entry.inputs?.activationId ?? entry.inputs?.taskId;
      return { runId: typeof run === 'string' && run ? run : `audit:${entry.id}`,
        invoiceId: typeof entry.inputs?.invoiceId === 'string' ? entry.inputs.invoiceId : null };
    });
    return [...readActivationUsage(activations), ...cases.flatMap(row => readCaseUsage(row.result, row.invoiceId).records),
      ...readAuditUsage(entries, link)];
  };
}

/** Mount as GET /api/costs on the trusted host. Never send the secret to a browser.
 * A server-side web proxy can call this handler; demo is always explicit.
 */
export function createCostSummaryHandler(options: {
  recorded?: () => Promise<readonly CostRecord[]>;
  secret?: () => string | undefined;
} = {}) {
  const recorded = options.recorded ?? createRecordedCostReader();
  return async (request: Request): Promise<Response> => {
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
    const secret = (options.secret ?? (() => process.env.TOOL_GATEWAY_SECRET))();
    if (!secret) return json({ error: 'GATEWAY_NOT_CONFIGURED' }, 503);
    const actual = Buffer.from(request.headers.get('authorization') ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return json({ error: 'UNAUTHORIZED' }, 401);
    if (request.method !== 'GET') return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET' });
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !['source', 'runId', 'invoiceId'].includes(key) || query.getAll(key).length !== 1)) {
      return json({ error: 'INVALID_QUERY' }, 400);
    }
    const source = query.get('source') ?? 'recorded';
    if (!['recorded', 'demo'].includes(source)) return json({ error: 'INVALID_SOURCE' }, 400);
    const runId = query.get('runId') ?? undefined, invoiceId = query.get('invoiceId') ?? undefined;
    if (runId === '' || invoiceId === '') return json({ error: 'INVALID_QUERY' }, 400);
    try {
      const records = source === 'demo' ? demoCostRecords() : await recorded();
      return json({ schemaVersion: 1, source, simulated: source === 'demo',
        accounting: 'Recorded model API USD only; GX10 excludes hardware/electricity. Tokens are known subtotals; latency is summed operation time, not elapsed run time. SDK sessions and standalone model/tool operations are accounting units, not HTTP attempt counts.',
        ...summarizeUsage(records, { runId, invoiceId }) });
    } catch {
      // Never fall back to demo or leak provider/customer error details.
      return json({ error: 'USAGE_UNAVAILABLE' }, 503);
    }
  };
}
