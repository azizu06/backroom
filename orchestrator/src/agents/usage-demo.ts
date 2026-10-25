import { readActivationUsage, type CostRecord } from './usage-reader';
import type { Role } from './contracts';

/** Synthetic accounting for the mocked AP #4401 and AR #1042 role chains.
 * These are illustrative receipts, not observed provider spend or benchmark results.
 * No model/network/payment call and no writes to the shared audit log.
 */
export function demoCostRecords(): CostRecord[] {
  const chains: { runId: string; invoiceId: string; roles: Role[] }[] = [
    { runId: 'demo-ap-4401', invoiceId: '4401', roles: ['intake', 'extractor', 'vendor', 'payables', 'auditor'] },
    { runId: 'demo-ar-1042', invoiceId: '1042', roles: ['collections', 'reconciler', 'auditor'] },
  ];
  return chains.flatMap(({ runId, invoiceId, roles }) => roles.flatMap((role, index) => {
    const activationId = `${runId}:${role}`;
    const cloud = readActivationUsage([{ runId: activationId, invoiceId, receipt: {
      activationId, sessionId: activationId, costUsd: (index + 1) / 1000, wallMs: 400 + index * 100, initMs: 50,
      modelUsage: { 'claude-haiku-5-5': { inputTokens: 1000 + index * 100, outputTokens: 100 + index * 10,
        cacheReadInputTokens: 200, cacheCreationInputTokens: 0 } },
    } }]);
    // Extractor's local eyes and collections' local planning run inside the SDK turn.
    return [...cloud, ...(['extractor', 'collections'].includes(role) ? [{
      id: `${activationId}:gx10`, runId: activationId, invoiceId, origin: 'local_tool' as const,
      execution: 'local' as const, models: ['qwen3:8b'], costUsd: 0,
      inputTokens: 700, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0, latencyMs: 1200,
    }] : [])];
  }));
}
