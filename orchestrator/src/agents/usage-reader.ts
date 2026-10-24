import type { AuditEntry } from '../store';
import type { UsageReceipt } from './contracts';
import { ACTIVATION_BUDGET_USD } from './usage';

/** One accounted operation. Unknown token counts stay null, never invented as zero. */
export interface CostRecord {
  id: string; runId: string; invoiceId: string | null;
  origin: 'sdk' | 'router' | 'local_tool'; execution: 'local' | 'cloud'; models: string[];
  costBasis?: 'reservation';
  costUsd: number; inputTokens: number | null; outputTokens: number | null;
  cacheReadTokens: number | null; cacheWriteTokens: number | null; latencyMs: number;
}
export interface ActivationUsage {
  runId: string; invoiceId: string | null; receipt: UsageReceipt;
}
const count = (n: unknown): number | null => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
const amount = (n: number) => {
  if (!Number.isFinite(n) || n < 0) throw new Error('INVALID_USAGE_AMOUNT');
  return n;
};
const sumKnown = (values: (number | null)[]) => values.every(v => v !== null)
  ? values.reduce<number>((sum, n) => sum + n!, 0) : null;

/** Input order is snapshot order. SDK receipts are cumulative per session: latest wins.
 * A session must belong to one run/invoice; callers must not reuse it across invoices.
 */
export function readActivationUsage(rows: readonly ActivationUsage[]): CostRecord[] {
  const sessions = new Map<string, ActivationUsage>();
  for (const row of rows) {
    if (row.receipt.sessionId === 'code' && row.receipt.costUsd === 0) continue;
    const key = row.receipt.sessionId || `activation:${row.receipt.activationId}`;
    const previous = sessions.get(key);
    if (previous && (previous.runId !== row.runId || previous.invoiceId !== row.invoiceId)) {
      throw new Error('AMBIGUOUS_USAGE_SESSION');
    }
    sessions.set(key, row);
  }
  return [...sessions.values()].map(({ runId, invoiceId, receipt }) => {
    const usage = Object.values(receipt.modelUsage).map(value =>
      value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    const tokens = (field: string) => usage.length ? sumKnown(usage.map(model => count(model[field]))) : null;
    return { id: `sdk:${receipt.sessionId || `activation:${receipt.activationId}`}`, runId, invoiceId, origin: 'sdk', execution: 'cloud',
      models: Object.keys(receipt.modelUsage).sort(), costUsd: amount(receipt.costUsd),
      inputTokens: tokens('inputTokens'), outputTokens: tokens('outputTokens'),
      cacheReadTokens: tokens('cacheReadInputTokens'), cacheWriteTokens: tokens('cacheCreationInputTokens'),
      latencyMs: amount(receipt.wallMs) };
  });
}

/** Explicit server-side linkage only. Never guess that refs[0] is an invoice.
 * SDK audit mirrors are excluded: SDK cumulative usage is its billing authority.
 */
export function readAuditUsage(entries: readonly AuditEntry[],
  link: (entry: AuditEntry) => { runId: string; invoiceId: string | null }): CostRecord[] {
  const result: CostRecord[] = [];
  for (const entry of entries) {
    const local = ['local', 'gx10_fallback'].includes(entry.route);
    if (!local && !['cloud', 'cloud_fallback'].includes(entry.route)) continue;
    if (!['local_model', 'claude'].includes(entry.actor)) continue;
    const model = entry.inputs?.model;
    if (typeof model !== 'string' || model === 'none' || !model) continue;
    result.push({ id: `audit:${entry.id}`, ...link(entry),
      origin: entry.action === 'local_extract' ? 'local_tool' : 'router', execution: local ? 'local' : 'cloud',
      models: [model], costUsd: amount(entry.costUsd), latencyMs: amount(entry.latencyMs),
      inputTokens: count(entry.inputs?.inputTokens), outputTokens: count(entry.inputs?.outputTokens),
      cacheReadTokens: count(entry.inputs?.cacheReadInputTokens), cacheWriteTokens: count(entry.inputs?.cacheCreationInputTokens) });
  }
  return result;
}

function totals(rows: readonly CostRecord[]) {
  const localCalls = rows.filter(r => r.execution === 'local').length;
  return { calls: rows.length, reservationCostUsd: rows.filter(r => r.costBasis === 'reservation').reduce((n, r) => n + r.costUsd, 0), costUsd: rows.reduce((n, r) => n + amount(r.costUsd), 0),
    inputTokens: rows.reduce((n, r) => n + (r.inputTokens ?? 0), 0),
    outputTokens: rows.reduce((n, r) => n + (r.outputTokens ?? 0), 0),
    cacheReadTokens: rows.reduce((n, r) => n + (r.cacheReadTokens ?? 0), 0),
    cacheWriteTokens: rows.reduce((n, r) => n + (r.cacheWriteTokens ?? 0), 0),
    tokenCompleteCalls: rows.filter(r => r.inputTokens !== null && r.outputTokens !== null).length,
    latencyMs: rows.reduce((n, r) => n + amount(r.latencyMs), 0),
    localCalls, cloudCalls: rows.length - localCalls,
    localShare: rows.length ? localCalls / rows.length : null,
    cloudShare: rows.length ? (rows.length - localCalls) / rows.length : null,
    localCostUsd: rows.filter(r => r.execution === 'local').reduce((n, r) => n + r.costUsd, 0),
    cloudCostUsd: rows.filter(r => r.execution === 'cloud').reduce((n, r) => n + r.costUsd, 0),
    models: [...new Set(rows.flatMap(r => r.models))].sort() };
}

export function summarizeUsage(records: readonly CostRecord[], filters: { runId?: string; invoiceId?: string } = {}) {
  // Retransmitted audit records must not multiply spend. Conflicting duplicates fail closed.
  const unique = new Map<string, CostRecord>();
  for (const record of records) {
    const previous = unique.get(record.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw new Error('CONFLICTING_USAGE_RECORD');
    unique.set(record.id, record);
  }
  const rows = [...unique.values()].filter(r => (!filters.runId || r.runId === filters.runId)
    && (!filters.invoiceId || r.invoiceId === filters.invoiceId));
  const runs = [...new Set(rows.map(r => r.runId))].sort().map(runId => {
    const group = rows.filter(r => r.runId === runId);
    return { runId, invoiceIds: [...new Set(group.flatMap(r => r.invoiceId === null ? [] : [r.invoiceId]))].sort(), ...totals(group) };
  });
  const invoices = [...new Set(rows.flatMap(r => r.invoiceId === null ? [] : [r.invoiceId]))].sort()
    .map(invoiceId => ({ invoiceId, ...totals(rows.filter(r => r.invoiceId === invoiceId)) }));
  return { totals: totals(rows), runs, invoices, unassignedCalls: rows.filter(r => r.invoiceId === null).length, records: rows };
}

/** Read the real dispatcher's result, including its conservative reservation charge
 * when SDK accounting is absent/NaN. Credential ledger totals are returned separately,
 * never allocated across invoices. No ledger methods (which can write files) are called.
 */
export function readCaseUsage(result: import('./dispatcher').CaseResult, invoiceId: string | null) {
  const records = result.activations.flatMap(activation => {
    const usage = activation.usage;
    if (usage?.sessionId === 'code' && usage.costUsd === 0) return [];
    const known = usage && Number.isFinite(usage.costUsd) && usage.costUsd > 0;
    if (known) return readActivationUsage([{ runId: activation.activationId, invoiceId, receipt: usage }])
      .map(record => ({ ...record, models: record.models.length ? record.models : activation.model ? [activation.model] : [] }));
    // The dispatcher reserves by model and charges this amount for unknown settlement.
    const model = activation.model;
    if (!model) return []; // no model started (e.g. missing role)
    return [{ id: `reservation:${activation.activationId}`, runId: activation.activationId, invoiceId,
      origin: 'sdk' as const, execution: 'cloud' as const, models: [model],
      costUsd: ACTIVATION_BUDGET_USD[model], inputTokens: null, outputTokens: null,
      cacheReadTokens: null, cacheWriteTokens: null, latencyMs: usage ? amount(usage.wallMs) : 0,
      costBasis: 'reservation' as const }];
  });
  return { caseId: result.caseId, records, ownerBudget: result.usage ?? null,
    caseChargedUsd: result.costUsd };
}
