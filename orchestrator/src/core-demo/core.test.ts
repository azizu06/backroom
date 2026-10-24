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
      balanceBeforeCents: 1000000, balanceAfterCents: 1247500,
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
    override async listDeposits() {
      const rows = await super.listDeposits();
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
