import { expect, it, vi } from 'vitest';
import { runCoreDemo } from './core';

it('runs the 3D-closed collection loop through denial, Dana, authorized payment and cited why', async () => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('NETWORK_FORBIDDEN'); }));
  try {
    const run = await runCoreDemo();
    expect(run.collection).toMatchObject({
      denial: { kind: 'DENY', rule_ids: ['FEES_NON_WAIVABLE'], can_confirm: false },
      escalation: { kind: 'ESCALATE', rule_ids: ['MAX_INSTALLMENTS'], can_confirm: false },
      targetAnchor: 'Dana_desk',
      approval: { approval_status: 'denied', can_confirm: false },
      allowed: { kind: 'ALLOW', can_confirm: true },
      amountCents: 247500, invoiceState: 'partially_paid',
      balanceBeforeCents: 2400000, balanceAfterCents: 2647500,
    });
    expect(run.preCall).toMatchObject({ status: 'ready', model: 'scripted-fixture' });
    expect(run.controllerRow).toMatchObject({ status: 'denied', method: 'passkey', decision: { kind: 'Deny' } });
    expect(run.chainValid).toBe(true);
    expect(run.answers).toHaveLength(2);
    for (const answer of run.answers) {
      expect(answer.citations.length).toBeGreaterThan(0);
      expect(answer.source).toBe('fallback');
    }
    expect(fetch).not.toHaveBeenCalled();
  } finally { vi.unstubAllGlobals(); }
});

it.each([false, true])('holds the #4471 bank change with LLM OFF=%s and never dispatches a bank effect', async llmOff => {
  const { runInboxTrap } = await import('./core');
  const run = await runInboxTrap({ llmOff });
  expect(run).toMatchObject({
    routing: { seat: 'payables', source: 'code' },
    decision: { decision: 'ESCALATE', ruleIds: ['LOOKALIKE_DOMAIN'] },
    bankChangeDecision: { kind: 'ESCALATE', ruleIds: ['BANK_CHANGE_HOLD'] },
    escalation: { status: 'pending', toHuman: 'Dana' },
    targetAnchor: 'Dana_desk', invoiceState: 'held', bankEffects: 0, modelRequests: 0, chainValid: true,
  });
  if (llmOff) expect(run.modelResult).toMatchObject({ kind: 'LLM_OFF', route: 'code', model: 'none' });
});

it.each(['short', 'duplicate'] as const)('refuses to mark a %s bank-feed match reconciled', async corruption => {
  const { FakeDemoBank } = await import('./bank');
  class CorruptFeed extends FakeDemoBank {
    override async listDeposits(accountId: string) {
      const rows = await super.listDeposits(accountId);
      return corruption === 'short' ? rows.map(row => ({ ...row, amount: row.amount - 1 })) : [...rows, ...rows];
    }
  }
  await expect(runCoreDemo({ bank: new CorruptFeed() })).rejects.toThrow('bank feed did not match');
});

it('detects audit tampering and keeps why citations attached to the recorded rules', async () => {
  const { verifyChain } = await import('./core');
  const run = await runCoreDemo();
  for (const answer of run.answers) {
    const cited = run.whyEntries.filter(entry => answer.citations.includes(entry.id));
    expect(cited.flatMap(entry => entry.ruleIds)).toEqual(expect.arrayContaining(['FEES_NON_WAIVABLE', 'MAX_INSTALLMENTS']));
  }
  run.entries[0]!.action = 'tampered';
  expect(verifyChain(run.entries)).toBe(false);
});


it('replays frozen AP traps, controller-approved Cedar change, and unmatched already-paid deposit', async () => {
  const { runNorthfieldPayables } = await import('./northfield');
  const run = await runNorthfieldPayables();
  expect(run.results).toHaveLength(8);
  expect(run.payments.map(row => [row.invoiceId, row.destinationAccountId])).toEqual([
    ['4401', 'bank-master:papertrail'], ['4480', 'SYNTHETIC-CEDAR-8822'],
  ]);
  expect(run.unverified).toBe('held');
  expect(run.sanctioned).toBe('rejected');
  expect(run.alreadyPaid).toBe('exception');
  expect(run.entries.find(row => row.action === 'bank_change_approved')?.actor).toBe('human');
});

it('uses an injected live planner while retaining actual policy and bank authorization', async () => {
  let calls = 0;
  const run = await runCoreDemo({ planner: { draft: async () => {
    calls++;
    return { route: 'local', model: 'network-mocked-model', latencyMs: 12, costUsd: 0,
      output: { tone: 'neutral', offerOrder: ['pay_in_full', 'installments'],
        plan: { installments: 2, firstPaymentPct: 50, totalDays: 30, waiveFees: false, discountPct: 0 } } };
  } } });
  expect(calls).toBe(1);
  expect(run.entries.find(entry => entry.action === 'call_plan')).toMatchObject({ actor: 'local_model', route: 'local', inputs: { model: 'network-mocked-model' } });
  expect(run.collection.invoiceState).toBe('partially_paid');
  expect(run.chainValid).toBe(true);
});
