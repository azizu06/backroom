import { expect, it } from 'vitest';
import { evaluate } from '@backroom/policy';
import { MemoryStateStore } from './memory-store';

it('keeps v1 immutable and changes three-installment authority to v2 with a human audit', async () => {
  const state = new MemoryStateStore();
  const v1 = await state.getPolicy();
  const action = { type: 'propose_plan' as const, plan: { installments: 3, firstPaymentPct: 50, totalDays: 30, waiveFees: false, discountPct: 0 } };
  const before = evaluate('collections', action, { policy: v1, identityConfirmed: true });
  expect(before).toMatchObject({ kind: 'ESCALATE', policyVersion: 1, ruleIds: ['MAX_INSTALLMENTS'] });
  await state.appendAudit({ ts: 1, actor: 'code', seat: 'collections', action: 'propose_plan', decision: before.kind,
    policyVersion: before.policyVersion, ruleIds: before.ruleIds, refs: [], route: 'code', latencyMs: 0, costUsd: 0 });
  const v2 = await state.savePolicyLimits(1, { maxInstallments: 3, minFirstPct: 50, maxPlanDays: 30, maxPaymentCents: 200000 }, 2);
  expect(v2.policyVersion).toBe(2);
  const after = evaluate('collections', action, { policy: await state.getPolicy(), identityConfirmed: true });
  expect(after).toMatchObject({ kind: 'ALLOW', policyVersion: 2 });
  await state.appendAudit({ ts: 3, actor: 'code', seat: 'collections', action: 'propose_plan', decision: after.kind,
    policyVersion: after.policyVersion, ruleIds: after.ruleIds, refs: [], route: 'code', latencyMs: 0, costUsd: 0 });
  expect(await state.listAudit()).toMatchObject([
    { decision: 'ESCALATE', policyVersion: 1 },
    { actor: 'human', action: 'save_policy', policyVersion: 2, inputs: { previousVersion: 1 } },
    { decision: 'ALLOW', policyVersion: 2 },
  ]);
  v2.badges.collections.limits.maxInstallments = 99;
  expect((await state.getPolicy(1)).badges.collections.limits.maxInstallments).toBe(2);
  expect((await state.getPolicy()).badges.collections.limits.maxInstallments).toBe(3);
  await expect(state.savePolicyLimits(1, { maxInstallments: 4, minFirstPct: 50, maxPlanDays: 30, maxPaymentCents: 200000 }, 4)).rejects.toThrow('POLICY_CONFLICT');
  expect((await state.listAudit()).length).toBe(3);
});

it('serializes competing owner saves and keeps the audit and snapshot atomic on failure', async () => {
  const state = new MemoryStateStore();
  const limits = { maxInstallments: 3, minFirstPct: 50, maxPlanDays: 30, maxPaymentCents: 300000 };
  const outcomes = await Promise.allSettled([state.savePolicyLimits(1, limits, 1), state.savePolicyLimits(1, limits, 1)]);
  expect(outcomes.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
  expect((await state.getPolicy()).policyVersion).toBe(2);
  expect((await state.listAudit()).length).toBe(1);
  await expect(state.savePolicyLimits(2, limits, -1)).rejects.toThrow('INVALID_AUDIT_INPUT');
  expect((await state.getPolicy()).policyVersion).toBe(2);
  expect((await state.listAudit()).length).toBe(1);
});
