import { expect, it } from 'vitest';
import { MemoryHandoffStore } from './handoff-store';
import { MemoryStateStore } from '../store';
import type { ToolContext } from './contracts';
import { Dispatcher } from './dispatcher';
import { ClaudeAgentRuntime } from './runtime';
import { scriptedQuery } from './mock-query';
import { MemoryUsageLedger } from './usage';

it('recovers only expired activations in the same case and audits fenced writes from the abandoned runner', async () => {
  let now = 1000;
  const audit = new MemoryStateStore();
  const store = new MemoryHandoffStore({ audit, now: () => now, activationLeaseMs: 100 });
  await store.openCase({ caseId: 'recovery', role: 'payables', artifactRefs: ['invoice:4401'] });
  const first = await store.startActivation('recovery', 'dead-runner');
  expect(first.activation.leaseExpiresAt).toBe(1100);
  const ctx: ToolContext = { activation: { ...first.activation, taskId: 'recovery', caseId: 'recovery',
    leaseOwner: 'dead-runner', leaseToken: first.activation.leaseToken!, llmGeneration: 1,
    signal: new AbortController().signal, credentialOwnerId: 'offline' }, assertCurrent: async () => {} };
  now = 1099;
  expect(await store.recoverExpired('recovery')).toBe(false);
  await expect(store.startActivation('recovery', 'intruder')).rejects.toThrow('AGENT_ACTIVATION_ACTIVE');
  now = 1100;
  await expect(store.recordArtifacts(ctx, ['forged:expired'])).rejects.toThrow('AGENT_LEASE_EXPIRED');
  expect(await store.recoverExpired('recovery')).toBe(true);
  expect(await store.recoverExpired('recovery')).toBe(false);
  const second = await store.startActivation('recovery', 'replacement');
  expect(second.activation.role).toBe('payables');
  expect(second.activation.artifactRefs).toEqual(['invoice:4401']);
  expect(second.activation.leaseToken).toBeGreaterThan(first.activation.leaseToken!);
  await expect(store.recordArtifacts(ctx, ['forged:stale'])).rejects.toThrow();
  await expect(store.finish(ctx, 'held')).rejects.toThrow();
  expect(typeof store.stopActiveCase).toBe('function');
  await expect(store.stopActiveCase(ctx.activation, 'cancelled', 'CANCELLED')).rejects.toThrow();
  await expect(store.commit(ctx, { to: 'auditor', artifactRefs: ['invoice:4401'], reason: 'stale', summary: 'stale' })).rejects.toThrow();
  const state = (await store.getCase('recovery'))!;
  expect(state.activeActivationId).toBe(second.activation.activationId);
  expect(state.activations[0]).toMatchObject({ status: 'failed', reason: 'LEASE_EXPIRED' });
  expect(state.knownRefs).not.toContain('forged:expired');
  expect(state.knownRefs).not.toContain('forged:stale');
  const rows = await audit.listAudit();
  expect(rows.filter(row => row.action === 'agent_activation_recovered')).toHaveLength(1);
  expect(rows.filter(row => row.action === 'agent_activation_write_rejected')).toHaveLength(5);
  expect((await audit.verifyAuditChain()).valid).toBe(true);
});

it('lets a replacement dispatcher drive an expired case but leaves a live runner untouched', async () => {
  let now = 1000;
  const control = new MemoryStateStore();
  const store = new MemoryHandoffStore({ audit: control, now: () => now, activationLeaseMs: 100 });
  const request = { caseId: 'recover-dispatch', role: 'collections' as const,
    artifactRefs: ['invoice:1042'], input: {}, credentialOwnerId: 'offline' };
  await store.openCase(request);
  await store.startActivation(request.caseId, 'abandoned');
  const runtime = new ClaudeAgentRuntime({ credential: () => 'offline', query: scriptedQuery(() => []) });
  const dispatcher = new Dispatcher({ runtime, store, ledger: new MemoryUsageLedger(), control, runnerId: 'replacement',
    roles: { collections: { role: 'collections', model: 'claude-haiku-5-5', prompt: 'Test terminal role.', tools: [], allowedNext: [] } } });
  expect(typeof dispatcher.recoverCase).toBe('function');
  expect(await dispatcher.recoverCase(request)).toMatchObject({ status: 'held', reason: 'AGENT_LEASE_NOT_EXPIRED', activations: [] });
  expect((await store.getCase(request.caseId))?.activeActivationId).toBe('recover-dispatch:a1');
  now = 1100;
  expect(await dispatcher.recoverCase(request)).toMatchObject({ status: 'done', activations: [{ role: 'collections', kind: 'done' }] });
  expect((await store.getCase(request.caseId))?.status).toBe('done');
});
