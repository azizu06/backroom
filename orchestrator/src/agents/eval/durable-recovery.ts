import { Dispatcher } from '../dispatcher';
import { SpacetimeHandoffStore } from '../handoff-store';
import { MemoryUsageLedger } from '../usage';
import { MemoryStateStore } from '../../store';
import type { StateTransport } from '../../spacetime-store';
import { mockRuntime } from './runtime';

/** Probe the production adapter's capability gate before provisioning a disposable DB.
 * A refusal here is an unexecuted scenario, never a passing recovery measurement. */
export async function runDurableRecoveryPreflight() {
  let transportCalls = 0, runtimeActivations = 0;
  const transport: StateTransport = {
    ready: Promise.resolve(),
    onControl: () => () => {},
    close() {},
    async invoke() {
      transportCalls++;
      throw new Error('DURABLE_PREFLIGHT_DATABASE_FORBIDDEN');
    },
  };
  const store = new SpacetimeHandoffStore(transport);
  const runtime = mockRuntime(store, async () => {
    runtimeActivations++;
    throw new Error('DURABLE_PREFLIGHT_MODEL_FORBIDDEN');
  }, () => {});
  const dispatcher = new Dispatcher({ runtime, store, ledger: new MemoryUsageLedger(),
    control: new MemoryStateStore(), roles: {}, runnerId: 'offline:P11-replacement' });
  const result = await dispatcher.recoverCase({ caseId: 'P11:durable-preflight', role: 'payables',
    credentialOwnerId: 'offline', artifactRefs: ['ap_invoice:4401'], input: {} });
  return {
    id: 'P11', status: result.status === 'held' ? 'blocked' : 'unexpected', reason: result.reason,
    store: 'SpacetimeHandoffStore', osKillExecuted: false, databaseConnected: false,
    transportCalls, runtimeActivations, costUsd: result.costUsd, result,
    scope: 'Production Dispatcher.recoverCase with the production SpacetimeHandoffStore refuses AGENT_RECOVERY_UNAVAILABLE before any database or runtime activation. No OS kill, database connection, provider debit or restart executed; not durable restart evidence. The P11 integration gap remains open.',
  };
}
