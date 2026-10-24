import { verifyChain } from '../audit';
import type { AuditEntry } from '../store';

export interface AuditRun {
  name: string;
  /** Unknown provenance is never counted as a live measurement. */
  kind: 'live' | 'simulated' | 'unknown';
  routingOverride?: boolean;
  entries: AuditEntry[];
}
export const missing = (reason: string) => `not measured — ${reason}`;
/** Nearest-rank percentiles, including every sample; no warmup trimming. */
export function percentile(values: number[], fraction: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
const local = new Set(['local', 'gx10_fallback']);
const modelRoutes = ['local', 'cloud', 'cloud_fallback', 'gx10_fallback'];
export function auditMetrics(runs: AuditRun[]) {
  const checked = runs.map(run => ({ ...run, status: verifyChain(run.entries) }));
  const live = checked.filter(run => run.status.valid && run.kind === 'live').flatMap(run => run.entries);
  // Route labels alone do not prove a model call: require its actor and model ID.
  const models = live.filter(entry => modelRoutes.includes(entry.route)
    && ['local_model', 'claude'].includes(entry.actor) && typeof entry.inputs?.model === 'string' && entry.inputs?.model !== 'none');
  const localCount = models.filter(entry => local.has(entry.route)).length;
  const routingOverride = checked.some(run => run.status.valid && run.kind === 'live' && run.routingOverride);
  const localShare = models.length
    ? `${(localCount / models.length * 100).toFixed(2)}% (${localCount}/${models.length}; ${routingOverride ? 'operator override; production C2 unverified' : `target ≥60%: ${localCount / models.length >= 0.6 ? 'met' : 'below target'}`})`
    : missing('no successful model receipts in verified live chains; scripted/stub calls excluded');
  return { checked, live, models, localShare, fallbacks: models.filter(entry => entry.route === 'cloud_fallback').length,
    costPerDecision: models.length ? models.reduce((sum, entry) => sum + entry.costUsd, 0) / models.length : undefined };
}
export function renderRoutes(result: ReturnType<typeof auditMetrics>): string {
  const rows = modelRoutes.map(route => {
    const entries = result.models.filter(entry => entry.route === route);
    if (!entries.length) return `| ${route} | 0 | not measured | not measured | not measured |`;
    const times = entries.map(entry => entry.latencyMs);
    return `| ${route} | ${entries.length} | ${percentile(times, 0.5)!.toFixed(2)} | ${percentile(times, 0.95)!.toFixed(2)} | $${(entries.reduce((sum, entry) => sum + entry.costUsd, 0) / entries.length).toFixed(6)} |`;
  });
  return ['| Route | Completed decisions | p50 ms | p95 ms | Estimated USD / decision |', '| --- | ---: | ---: | ---: | ---: |', ...rows].join('\n');
}
export const table = (rows: [string, string | number, string][]) => [
  '| Metric | Observed | Evidence / limitation |', '| --- | --- | --- |',
  ...rows.map(row => `| ${row.map(cell => String(cell).replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`),
].join('\n');
