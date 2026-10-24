import { describe, expect, it, vi } from 'vitest';
import { MemoryStateStore, type AuditInput } from '../../store';
import type { ActivationResult, AgentRuntime, HandoffRequest, Specialist, ToolContext } from '../contracts';
import { createAuditTools, validateAuditorCorrection } from '../tools/audit';
import { createAuditor, runAuditor } from './auditor';

async function setup(correctionCount = 0) {
  const store = new MemoryStateStore();
  const input: AuditInput = { ts: 1, actor: 'code', seat: 'payables', action: 'pay_invoice', decision: 'ALLOW',
    policyVersion: 1, ruleIds: [], refs: ['case-42'], route: 'code', latencyMs: 0, costUsd: 0 };
  const row = await store.appendAudit(input);
  const signal = new AbortController();
  const ctx: ToolContext = { activation: { caseId: 'case-42', taskId: 'task-42', activationId: 'audit-42', role: 'auditor',
    leaseOwner: 'runner', leaseToken: 1, llmGeneration: 1, artifactRefs: [row.id], credentialOwnerId: 'owner', signal: signal.signal },
    assertCurrent: async () => { if (!store.llmEnabled) throw new Error('LLM_OFF'); } };
  const deps = { store, loadCase: async () => ({ refs: ['case-42'], correctionCount }) };
  const request: HandoffRequest = { to: 'payables', reason: `Please supply receipt:${row.id}; do not replay the payment.`,
    summary: 'Receipt evidence missing.', artifactRefs: [row.id] };
  return { store, row, ctx, deps, request, signal };
}

describe('Auditor activation and correction boundary', () => {
  it('runs one Haiku activation with only the four audit tools and an evidence-owning destination', async () => {
    const { ctx, deps } = await setup();
    const result: ActivationResult = { kind: 'held', artifactRefs: [], usage: { activationId: 'audit-42', sessionId: 'mock',
      costUsd: 0, modelUsage: {}, wallMs: 1, initMs: 1 } };
    const runtime: AgentRuntime = { run: vi.fn(async (spec: Specialist) => {
      expect(spec.role).toBe('auditor');
      expect(spec.model).toBe('claude-haiku-5-5');
      expect(spec.tools.map(tool => tool.name)).toEqual(['read_audit', 'verify_chain', 'get_receipt', 'record_case_summary']);
      expect(spec.allowedNext).toEqual(['payables']);
      return result;
    }) };
    expect(await runAuditor(runtime, ctx, {}, deps)).toEqual(result);
    expect(runtime.run).toHaveBeenCalledTimes(1);
  });

  it('accepts only the exact missing item, owning role, real audit id and bounded return count', async () => {
    const { ctx, deps, request } = await setup();
    await expect(validateAuditorCorrection(ctx, request, deps)).resolves.toBeUndefined();
    for (const patch of [{ to: 'vendor' as const }, { reason: 'Check it again' }, { artifactRefs: ['audit:fake'] }]) {
      await expect(validateAuditorCorrection(ctx, { ...request, ...patch }, deps)).rejects.toThrow('AUDITOR_CORRECTION_NOT_ALLOWED');
    }
    const exhausted = await setup(2);
    expect((await createAuditor(exhausted.ctx, exhausted.deps)).allowedNext).toEqual([]);
    await expect(validateAuditorCorrection(exhausted.ctx, exhausted.request, exhausted.deps))
      .rejects.toThrow('AUDITOR_CORRECTION_NOT_ALLOWED');
  });

  it('fences OFF and aborted activations, role spoofing, and late provider results', async () => {
    const { ctx, deps, store, signal } = await setup();
    const tools = createAuditTools(deps);
    await expect(tools.readAudit.execute({ ...ctx, activation: { ...ctx.activation, role: 'payables' } }, {}))
      .rejects.toThrow('AUDITOR_CAPABILITY_REQUIRED');
    await store.setLlmEnabled(false);
    await expect(tools.readAudit.execute(ctx, {})).rejects.toThrow('LLM_OFF');
    await store.setLlmEnabled(true);
    signal.abort(new Error('STALE_GENERATION'));
    await expect(tools.verifyChain.execute(ctx, {})).rejects.toThrow('STALE_GENERATION');

    const fresh = await setup();
    await fresh.store.appendAudit({ ts: 2, actor: 'system', seat: 'payables', action: 'nessie_completed', policyVersion: 1,
      ruleIds: [], refs: ['case-42'], route: 'external', latencyMs: 0, costUsd: 0, inputs: { receiptId: 'bank-42' } });
    const lateTools = createAuditTools({ ...fresh.deps, loadReceipt: async id => {
      await fresh.store.setLlmEnabled(false);
      return { id, status: 'completed' };
    } });
    await expect(lateTools.recordSummary.execute(fresh.ctx, {
      summary: `Paid [entry:${fresh.row.id}].`, citations: [fresh.row.id],
    })).rejects.toThrow('LLM_OFF');
    expect((await fresh.store.listAudit()).some(row => row.action === 'case_summary')).toBe(false);
  });
});

describe('Auditor runtime result validation', () => {
  it('rejects a runtime handoff that omits the exact evidence request', async () => {
    const { ctx, deps, request } = await setup();
    const runtime: AgentRuntime = { run: async () => ({ kind: 'handoff', request: { ...request, reason: 'Pay it again' },
      usage: { activationId: 'audit-42', sessionId: 'mock', costUsd: 0, modelUsage: {}, wallMs: 1, initMs: 1 } }) };
    await expect(runAuditor(runtime, ctx, {}, deps)).rejects.toThrow('AUDITOR_CORRECTION_NOT_ALLOWED');
  });

  it('refuses done based on assistant prose or a prior activation summary', async () => {
    const { ctx, deps } = await setup();
    const runtime: AgentRuntime = { run: async () => ({ kind: 'done', artifactRefs: ['audit:invented'],
      usage: { activationId: 'audit-42', sessionId: 'mock', costUsd: 0, modelUsage: {}, wallMs: 1, initMs: 1 } }) };
    await expect(runAuditor(runtime, ctx, {}, deps)).rejects.toThrow('AUDITOR_SUMMARY_REQUIRED');
  });
});

describe('Auditor successful activation', () => {
  it('returns done only with the summary actually recorded by this activation', async () => {
    const { ctx, deps, store } = await setup();
    // A held-only case needs a historical explanation, no bank effect.
    const held = await store.appendAudit({ ts: 2, actor: 'code', seat: 'payables', action: 'pay_invoice', decision: 'DENY',
      policyVersion: 1, ruleIds: [], refs: ['held-case'], route: 'code', latencyMs: 0, costUsd: 0 });
    const heldCtx = { ...ctx, activation: { ...ctx.activation, caseId: 'held-case' } };
    const heldDeps = { ...deps, loadCase: async () => ({ refs: ['held-case'], correctionCount: 0 }) };
    const runtime: AgentRuntime = { run: async (spec, context) => {
      const tool = spec.tools.find(tool => tool.name === 'record_case_summary')!;
      const result = await tool.execute(context, { summary: `Payment denied [entry:${held.id}].`, citations: [held.id] }) as { artifactRefs: string[] };
      return { kind: 'done', artifactRefs: result.artifactRefs,
        usage: { activationId: 'audit-42', sessionId: 'mock', costUsd: 0, modelUsage: {}, wallMs: 1, initMs: 1 } };
    } };
    expect(await runAuditor(runtime, heldCtx, {}, heldDeps)).toMatchObject({ kind: 'done', artifactRefs: expect.arrayContaining([expect.stringMatching(/^case-summary:/)]) });
  });
});
