import { expect, test } from 'vitest';
import { harnessStore } from './transport';
import { SpacetimeHandoffStore } from '../../orchestrator/src/agents/handoff-store';
import { Dispatcher } from '../../orchestrator/src/agents/dispatcher';
import { ClaudeAgentRuntime } from '../../orchestrator/src/agents/runtime';
import { scriptedQuery } from '../../orchestrator/src/agents/mock-query';
import { MemoryUsageLedger } from '../../orchestrator/src/agents/usage';
import { createDemoTeam, DEMO_CASES, DEMO_SCRIPTS } from '../../orchestrator/src/agents/demo-team';
import type { Role } from '../../orchestrator/src/agents/contracts';

// Real agent_* reducers on the SDK's local WASM datastore; scripted model turns, no network.
test('agent handoff reducers run the AR chain atomically and publish only the sanitized projection', async () => {
  const { h, transport, store: state } = harnessStore();
  const store = new SpacetimeHandoffStore(transport);
  const team = await createDemoTeam();
  const runtime = new ClaudeAgentRuntime({ credential: () => 'mock', query: scriptedQuery(role => DEMO_SCRIPTS[role as Role]()),
    recordArtifacts: (ctx, refs) => store.recordArtifacts(ctx, refs) });
  const dispatcher = new Dispatcher({ runtime, store, control: state, roles: team.roles, runnerId: 'runner', ledger: new MemoryUsageLedger() });
  const result = await dispatcher.runCase(DEMO_CASES()[1]!);
  expect(result).toMatchObject({ status: 'done' });
  expect(result.activations.map(a => a.role)).toEqual(['collections', 'reconciler', 'auditor']);
  const rows = [...h.db.agent_handoff_public.iter()].sort((a, b) => Number(a.sequence - b.sequence));
  expect(rows.map(r => `${r.fromRole}>${r.toRole}:${r.status}:${r.toVoiceRole}`)).toEqual(['collections>reconciler:completed:reconciler', 'reconciler>auditor:completed:auditor']);
  expect(Object.keys(rows[0]!)).not.toContain('artifactRefs');
  expect([...h.db.agent_case.iter()][0]!.status).toBe('done');
  expect((await store.listPublic()).map(r => r.sequence)).toEqual([1, 2]);
  expect([...h.db.audit_entry.iter()].map(a => a.action)).toEqual(expect.arrayContaining(['agent_handoff_offered', 'agent_handoff_accepted', 'agent_handoff_completed']));
  expect((await state.verifyAuditChain()).valid).toBe(true);
});

test('agent reducers fence a stale lease and reject a forged evidence ref with a public rejected row', async () => {
  const { h, transport } = harnessStore();
  const store = new SpacetimeHandoffStore(transport);
  await store.openCase({ caseId: 'c1', role: 'extractor', artifactRefs: ['doc:1'] });
  const { activation } = await store.startActivation('c1', 'runner');
  const ctx = { activation: { caseId: 'c1', taskId: 'c1', activationId: activation.activationId, role: 'extractor' as const, leaseOwner: 'runner',
    leaseToken: activation.leaseToken!, llmGeneration: 1, artifactRefs: ['doc:1'], credentialOwnerId: 'o', signal: new AbortController().signal }, assertCurrent: async () => {} };
  await expect(store.assertActive({ ...ctx.activation, leaseToken: 9 })).rejects.toThrow('AGENT_LEASE_STALE');
  await expect(store.commit(ctx, { to: 'vendor', reason: 'r', summary: 's', artifactRefs: ['doc:forged'] })).rejects.toThrow('HANDOFF_UNKNOWN_REF');
  expect([...h.db.agent_handoff_public.iter()][0]).toMatchObject({ status: 'rejected', errorCode: 'HANDOFF_UNKNOWN_REF' });
  await expect(store.commit(ctx, { to: 'vendor', reason: 'r', summary: 's', artifactRefs: ['doc:1'] })).rejects.toThrow('HANDOFF_ALREADY_REJECTED');
});
