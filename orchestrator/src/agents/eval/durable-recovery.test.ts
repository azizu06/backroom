import { expect, it, vi } from 'vitest';
import { runDurableRecoveryPreflight } from './durable-recovery';

it('reports the durable Dispatcher recovery refusal without claiming an OS kill or querying a shared database', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_NETWORK'));
  try {
    const run = await runDurableRecoveryPreflight();
    expect(run).toMatchObject({
      id: 'P11', status: 'blocked', reason: 'AGENT_RECOVERY_UNAVAILABLE',
      store: 'SpacetimeHandoffStore', osKillExecuted: false, databaseConnected: false,
      transportCalls: 0, runtimeActivations: 0, costUsd: 0,
      result: { status: 'held', activations: [], handoffs: [], artifactRefs: [] },
    });
    expect(run.scope).toContain('not durable restart evidence');
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});
