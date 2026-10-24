import { expect, test } from 'vitest';
import { MemoryStateStore } from '../store';
import { MemoryUsageLedger } from '../agents/usage';
import { scriptedQuery, type ScriptedCall } from '../agents/mock-query';
import type { QueryFn } from '../agents/runtime';
import { createLiveAnalyst } from './live';
import { runAttackDemo } from './index';

function setup(costUsd = 0.0004) {
  const state = new MemoryStateStore();
  const ledger = new MemoryUsageLedger();
  const calls: ScriptedCall[] = [];
  const query = scriptedQuery(() => [
    { tool: 'pay_invoice', args: { amountCents: 999900 } },
    { tool: 'record_attack_assessment', args: { proposal: 'Untrusted email requests an unapproved bank destination and claims owner approval.' } },
  ], { calls, costUsd });
  const options = { enabled: () => true, credential: () => 'synthetic-test-key', query, ledger, state: () => state };
  return { state, ledger, calls, options };
}

test('opt-in runs the real restricted SDK adapter and usage ledger; narrative cannot override policy', async () => {
  const { ledger, calls, options } = setup();
  const analyst = createLiveAnalyst(options);
  const trace = await runAttackDemo({ presetId: 'prompt-injection', mode: 'live' }, { analyst });
  expect(trace.modelEvidence).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5', usage: { costUsd: 0.0004 } });
  expect(trace.decision.ruleIds).toContain('BANK_CHANGE_HOLD');
  expect(trace.moneyMoved).toBe(false);
  expect(calls.find(call => call.tool === 'pay_invoice')?.denied).toBe('Tool not available to this specialist');
  expect(await ledger.usage('aziz')).toMatchObject({ spentUsd: 0.0004, reservedUsd: 0 });
  await expect(analyst('second attempt')).rejects.toMatchObject({ status: 429 });
});

test('OFF prevents an activation and does not consume the single attempt or reserve money', async () => {
  const { state, ledger, options } = setup();
  const analyst = createLiveAnalyst(options);
  await state.setLlmEnabled(false);
  await expect(analyst('untrusted')).rejects.toMatchObject({ status: 409 });
  expect(await ledger.usage('aziz')).toMatchObject({ spentUsd: 0, reservedUsd: 0 });
  await state.setLlmEnabled(true);
  expect((await analyst('untrusted')).usage.costUsd).toBe(0.0004);
});

test('an OFF/ON cycle fences late output while preserving its usage charge', async () => {
  const { state, ledger, options } = setup();
  const underlying = options.query;
  const query: QueryFn = (params, definitions) => {
    const stream = underlying(params, definitions);
    const wrapped = (async function* () {
      yield* stream;
      await state.setLlmEnabled(false);
      await state.setLlmEnabled(true);
    })();
    return Object.assign(wrapped, { close: () => stream.close() });
  };
  const analyst = createLiveAnalyst({ ...options, query });
  await expect(analyst('untrusted')).rejects.toMatchObject({ status: 409 });
  expect(await ledger.usage('aziz')).toMatchObject({ spentUsd: 0.0004, reservedUsd: 0 });
});

test('missing usage is charged at the reservation and failed live runs never retry', async () => {
  const { ledger, options } = setup(0);
  const analyst = createLiveAnalyst(options);
  await expect(analyst('untrusted')).rejects.toMatchObject({ status: 502 });
  expect(await ledger.usage('aziz')).toMatchObject({ spentUsd: 0.02, reservedUsd: 0, unknownSettlements: 1 });
  await expect(analyst('retry')).rejects.toMatchObject({ status: 429 });
});
