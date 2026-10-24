import { anthropicCostUsd } from './anthropic';

/** Aggregate only: no document contents, model text, keys, or customer identifiers. */
export interface RouterTelemetry {
  scope: 'process-local, last 200 HTTP attempts';
  totalCalls: number;
  localCalls: number;
  localShare: number | null;
  pricedLocalCalls: number;
  estimatedSavingsUsd: number | null;
  comparisonModel: string;
  recent: { at: string; latencyMs: number; tokensPerSecond: number | null } | null;
}
type Usage = { prompt_tokens?: number; completion_tokens?: number };
type Receipt = { local: boolean; at: number; latencyMs: number; outputTokens: number | null; savings: number | null; accepted: boolean; ok: boolean };
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function createRouterTelemetry(comparisonModel: string) {
  const receipts: Receipt[] = [];
  return {
    record(local: boolean, latencyMs: number, usage?: Usage, ok = true) {
      let savings: number | null = null;
      if (local && count(usage?.prompt_tokens) && count(usage?.completion_tokens)) {
        try {
          savings = anthropicCostUsd({ model: comparisonModel, usage: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens } });
        } catch { /* Unknown pricing is unavailable, never invented or a routing failure. */ }
      }
      const receipt: Receipt = { local, at: Date.now(), latencyMs: Math.max(0, latencyMs),
        outputTokens: count(usage?.completion_tokens) ? usage.completion_tokens : null, savings, accepted: false, ok };
      receipts.push(receipt);
      if (receipts.length > 200) receipts.shift();
      // Only route() may accept a validated, confident, non-cancelled local result.
      return () => { if (local && ok) receipt.accepted = true; };
    },
    snapshot(): RouterTelemetry {
      const local = receipts.filter(row => row.local);
      const metered = local.filter(row => row.savings !== null);
      const priced = metered.filter(row => row.accepted);
      const recent = local.filter(row => row.ok && Date.now() - row.at <= 60_000).at(-1);
      return { scope: 'process-local, last 200 HTTP attempts', totalCalls: receipts.length, localCalls: local.length,
        localShare: receipts.length ? local.length / receipts.length : null, comparisonModel,
        pricedLocalCalls: priced.length,
        estimatedSavingsUsd: metered.length ? priced.reduce((sum, row) => sum + row.savings!, 0) : null,
        recent: recent ? { at: new Date(recent.at).toISOString(), latencyMs: recent.latencyMs,
          tokensPerSecond: recent.outputTokens !== null && recent.latencyMs > 0 ? recent.outputTokens * 1000 / recent.latencyMs : null } : null };
    },
  };
}
