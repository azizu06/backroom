import { describe, expect, it } from 'vitest';
import { summarizeUsage, type CostRecord } from './usage-reader';
import { readActivationUsage, readAuditUsage } from './usage-reader';
import type { UsageReceipt } from './contracts';
import type { AuditEntry } from '../store';
import { readCaseUsage } from './usage-reader';
import { Dispatcher, type CaseResult } from './dispatcher';
import { createDemoTeam, DEMO_CASES, DEMO_SCRIPTS } from './demo-team';
import { ClaudeAgentRuntime } from './runtime';
import { scriptedQuery } from './mock-query';
import { MemoryUsageLedger } from './usage';
import type { Role } from './contracts';
const row = (overrides: Partial<CostRecord> = {}): CostRecord => ({
  id: 'a', runId: 'run-ap', invoiceId: '4401', origin: 'router', execution: 'cloud',
  models: ['claude-haiku-5-5'], costUsd: .003, inputTokens: 100, outputTokens: 20,
  cacheReadTokens: 0, cacheWriteTokens: 0, latencyMs: 200, ...overrides,
});

describe('cost summary', () => {
  it('aggregates invoice/run dollars, token coverage and GX10 call share without counting policy events', () => {
    const result = summarizeUsage([
      row(), row({ id: 'b', execution: 'local', models: ['qwen3:8b'], costUsd: 0, latencyMs: 800 }),
      row({ id: 'c', runId: 'run-ar', invoiceId: '1042', costUsd: .007, inputTokens: null, outputTokens: null }),
    ]);
    expect(result.totals).toMatchObject({ calls: 3, costUsd: .01, inputTokens: 200, outputTokens: 40,
      tokenCompleteCalls: 2, localCalls: 1, cloudCalls: 2, localShare: 1 / 3, latencyMs: 1200 });
    expect(result.invoices.find(i => i.invoiceId === '4401')).toMatchObject({ costUsd: .003, calls: 2, localShare: .5 });
    expect(result.runs.find(i => i.runId === 'run-ap')?.models).toEqual(['claude-haiku-5-5', 'qwen3:8b']);
    expect(summarizeUsage([]).totals.localShare).toBeNull();
  });
});


it('replaces cumulative SDK session snapshots, includes cache tokens and rejects cross-invoice sessions', () => {
  const receipt: UsageReceipt = { activationId: 'a', sessionId: 's', costUsd: .01, wallMs: 900, initMs: 20,
    modelUsage: { haiku: { inputTokens: 80, outputTokens: 10, cacheReadInputTokens: 50, cacheCreationInputTokens: 30 } } };
  const first = { runId: 'ap', invoiceId: '4401', receipt };
  const latest = { ...first, receipt: { ...receipt, costUsd: .02 } };
  const records = readActivationUsage([first, latest]);
  expect(summarizeUsage(records).totals).toMatchObject({ calls: 1, costUsd: .02, inputTokens: 80,
    cacheReadTokens: 50, cacheWriteTokens: 30, latencyMs: 900 });
  expect(() => readActivationUsage([first, { ...latest, invoiceId: '1042' }])).toThrow('AMBIGUOUS_USAGE_SESSION');
});

it('reads router/local tool audits, ignores code and SDK mirrors, and keeps missing tokens unknown', () => {
  const entry: AuditEntry = { id: 'one', seq: 1, ts: 1, hash: '', prevHash: '', actor: 'local_model', seat: 'payables',
    action: 'local_extract', route: 'local', inputs: { model: 'qwen3:8b' }, refs: ['document'],
    ruleIds: [], policyVersion: 1, costUsd: 0, latencyMs: 100 };
  const records = readAuditUsage([entry, { ...entry, id: 'policy', actor: 'code' },
    { ...entry, id: 'sdk', route: 'claude-agent-sdk' }], () => ({ runId: 'ap', invoiceId: null }));
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ origin: 'local_tool', execution: 'local', inputTokens: null });
  expect(summarizeUsage([...records, ...records])).toMatchObject({ unassignedCalls: 1, totals: { calls: 1, tokenCompleteCalls: 0 } });
  expect(() => summarizeUsage([row(), row({ costUsd: 5 })])).toThrow('CONFLICTING_USAGE_RECORD');
});


it('reads the real dispatcher mocked AP and AR chains without live spend', async () => {
  const { control, roles, store } = await createDemoTeam();
  const runtime = new ClaudeAgentRuntime({ credential: () => 'mock',
    query: scriptedQuery(role => DEMO_SCRIPTS[role as Role]?.() ?? []),
    recordArtifacts: (ctx, refs) => store.recordArtifacts(ctx, refs) });
  const dispatcher = new Dispatcher({ control, roles, store, runtime, ledger: new MemoryUsageLedger(), runnerId: 'cost-test' });
  for (const request of DEMO_CASES()) {
    const result = await dispatcher.runCase(request);
    expect(result.status).toBe('done');
    const read = readCaseUsage(result, request.caseId === 'ap-4401' ? '4401' : '1042');
    expect(summarizeUsage(read.records).totals.costUsd).toBeCloseTo(result.costUsd, 10);
    expect(read.ownerBudget?.unknownSettlements).toBe(0);
  }
});

it('shows the ledger reservation charge for missing accounting, never as a free cloud run', () => {
  const result: CaseResult = { caseId: 'case', status: 'failed', artifactRefs: [], handoffs: [], costUsd: .02,
    activations: [{ activationId: 'a', role: 'intake', model: 'claude-haiku-5-5', kind: 'failed' }],
    usage: { spentUsd: .02, reservedUsd: 0, unknownSettlements: 1, warn: false } };
  const read = readCaseUsage(result, '4401');
  expect(summarizeUsage(read.records).totals).toMatchObject({ costUsd: .02, reservationCostUsd: .02, tokenCompleteCalls: 0 });
  expect(read.ownerBudget).toEqual(result.usage);
});

it('keeps session-less activations distinct and excludes code-only receipts', () => {
  const receipt: UsageReceipt = { activationId: 'one', sessionId: '', costUsd: .001, modelUsage: {}, wallMs: 5, initMs: 0 };
  const records = readActivationUsage([
    { runId: 'one', invoiceId: null, receipt },
    { runId: 'two', invoiceId: null, receipt: { ...receipt, activationId: 'two' } },
    { runId: 'code', invoiceId: null, receipt: { ...receipt, sessionId: 'code', costUsd: 0 } },
  ]);
  expect(summarizeUsage(records).totals).toMatchObject({ calls: 2, costUsd: .002 });
});
