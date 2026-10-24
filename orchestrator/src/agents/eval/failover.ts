import { runInvoice } from './chain';

type Run = Awaited<ReturnType<typeof runInvoice>>;
/** The decision-relevant outcome of one AP item; latency, cost and route are compared separately. */
function outcome(run: Run) {
  return { actual: run.actual, status: run.result.status ?? null, ruleIds: run.assessment.ruleIds ?? run.vendorDecision?.ruleIds ?? run.vendor.ruleIds ?? [],
    vendor: run.vendorDecision?.kind ?? null, mockDebits: run.mockDebits, destinations: run.destinations, extraction: run.extraction ?? null,
    runtime: run.runtime.status, roles: run.runtime.activations.map(row => `${row.role}:${row.kind}`) };
}

/** P12: the same frozen snapshot through the production Dispatcher, once with GX10 healthy and once with
 * every GX10 request failing. Extraction falls back inside the same tool call through the production
 * router to a canned Anthropic transport; no network, key or spend. */
export async function runFailoverPair(scenarioId: string, invoiceId: string, options: { caseId: string; pendingBankChange?: boolean; senderDomain?: string }) {
  const baseline = await runInvoice(invoiceId, { ...options, caseId: `${options.caseId}:gx10`, gx10: 'healthy' });
  const cut = await runInvoice(invoiceId, { ...options, caseId: `${options.caseId}:cut`, gx10: 'cut' });
  const before = outcome(baseline), after = outcome(cut);
  const sameOutcome = JSON.stringify(before) === JSON.stringify(after);
  const baselineRoutes = baseline.routing.audits.map(row => row.route);
  const cutRoutes = cut.routing.audits.map(row => row.route);
  const fallbackAudited = cut.routing.audits.length > 0 && cut.routing.audits.every(row => row.route === 'cloud_fallback' &&
    row.ruleIds.includes('ROUTE_FALLBACK') && typeof row.model === 'string' && row.latencyMs >= 0 && row.costUsd > 0);
  const match = sameOutcome && baselineRoutes.length > 0 && baselineRoutes.every(route => route === 'local') &&
    baseline.routing.cloudRequests === 0 && fallbackAudited && cut.routing.cloudRequests === cutRoutes.length && cut.routing.cloudTextOnly;
  const brief = (row: typeof before) => ({ ...row, extraction: undefined, destinations: undefined });
  return { id: `${scenarioId}:${invoiceId}`, scenarioId, invoiceId, match, sameOutcome, outcome: brief(before),
    cutOutcome: sameOutcome ? undefined : brief(after), baselineRoutes, cutRoutes, fallbackAudited,
    cloudRequests: cut.routing.cloudRequests, cloudTextOnly: cut.routing.cloudTextOnly,
    syntheticFallbackCostUsd: cut.routing.audits.reduce((sum, row) => sum + row.costUsd, 0),
    models: [...new Set(cut.routing.audits.map(row => String(row.model)))] };
}
