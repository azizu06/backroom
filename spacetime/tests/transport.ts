import { Timestamp } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import schema, * as reducers from '../src/index';
import { SpacetimeStateStore, type StateTransport, type ControlSnapshot } from '../../orchestrator/src/spacetime-store';

// Caller time drives ONLY the test harness clock. Production reducers always
// obtain ctx.timestamp from SpacetimeDB, and ignore those arguments on the wire.
const clockAt: Record<string, number> = { savePolicyLimits: 2, registerAgent: 2, heartbeat: 1, claimTask: 1, renewLease: 1,
  assertLease: 1, reapExpired: 0, setAgentState: 2, setAgentTargetLeased: 2, pauseTask: 1, advanceTask: 1,
  completeTask: 2, createEscalation: 2, createCallEscalation: 1, setCallPresence: 3, decideEscalation: 1, expireEscalations: 0,
  reservePayment: 3, recordPayment: 2, transitionInvoice: 4 };
export function harnessStore() {
  const h = createModuleTestHarness(schema, reducers);
  const auth = TestAuth.internal();
  h.withReducerTx(auth, ctx => reducers.init(ctx, {}));
  const listeners = new Set<(control: ControlSnapshot) => void>();
  let request = 0;
  const snapshot = () => {
    const row = h.db.runtime_control.id.find('global')!;
    return { enabled: row.llmEnabled, generation: row.generation, connected: true };
  };
  const transport: StateTransport = {
    ready: Promise.resolve(),
    onControl(listener) { listeners.add(listener); listener(snapshot()); return () => { listeners.delete(listener); }; },
    close() {},
    async invoke(method, values) {
      if (clockAt[method] !== undefined) h.clock.set(new Timestamp(BigInt(values[clockAt[method]!] as number) * 1000n));
      // Audit test vectors remain deterministic through the harness's server clock.
      if (method === 'appendAudit') h.clock.set(new Timestamp(BigInt((values[0] as { ts: number }).ts) * 1000n));
      if (method === 'appendAudits' && (values[0] as { ts: number }[]).length) h.clock.set(new Timestamp(BigInt((values[0] as { ts: number }[])[0]!.ts) * 1000n));
      const name = method.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`) as keyof typeof reducers;
      const id = `test-${++request}`;
      const fn = reducers[name] as typeof reducers.get_agent;
      h.withReducerTx(auth, ctx => fn(ctx, { requestId: id, payload: JSON.stringify(values) }));
      for (const listener of listeners) listener(snapshot());
      const value = JSON.parse(h.db.operation_result.id.find(id)!.result).value;
      h.withReducerTx(auth, ctx => reducers.ack_result(ctx, { requestId: id }));
      return value ?? undefined;
    },
  };
  return { store: new SpacetimeStateStore({ transport }), h, auth, transport };
}
