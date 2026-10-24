import { expect, it, vi } from 'vitest';
import { benchmarkCases, renderBenchmark, runBenchmarkCase, type BenchmarkReceipt } from './inbox-benchmark';
import { northfieldInvoice } from '../payables';
import type { route } from '../router';

it('runs real policy holds and a legitimate mock payment after schema-validated model output', async () => {
  const clean = benchmarkCases().find(row => row.id === 'P01')!;
  const model = (invoiceId: string): typeof route => vi.fn(async (task, _input, schema) => ({
    output: schema!.parse(task === 'inbox_classification' ? {kind:'invoice'} : northfieldInvoice(invoiceId)),
    route: 'local', model: 'mock', latencyMs: 1, costUsd: 0,
  })) as typeof route;
  const allowed = await runBenchmarkCase(clean, 'ON', model('4401'));
  expect(allowed.held).toBe(false); expect(allowed.mockPayments).toBe(1);
  const duplicate = await runBenchmarkCase(benchmarkCases().find(row => row.id === 'P02')!, 'ON', model('4419'));
  expect(duplicate.held).toBe(true); expect(duplicate.mockPayments).toBe(0);
  expect(duplicate.ruleIds).toContain('DUPLICATE_INVOICE');
});

it('OFF extracts the structured P01 attachment with zero HTTP requests and still evaluates policy', async () => {
  const http = vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('network forbidden'));
  const result = await runBenchmarkCase(benchmarkCases().find(row => row.id === 'P01')!, 'OFF');
  expect(http).not.toHaveBeenCalled(); http.mockRestore();
  expect(result.held).toBe(false); expect(result.mockPayments).toBe(1); expect(result.calls[0]?.outcome).toBe('LLM_OFF');
  const receipt: BenchmarkReceipt = {version:1, measuredAt:'test', sourceSha:'test', hashes:{},scope:'test',results:[result]};
  const report = renderBenchmark(receipt);
  expect(report).toContain('northfield LLM OFF: false hold | 0/1 (0.00%)');
  expect(report).toContain('P01 (OFF; IN_BADGE) | allowed | IN_BADGE');
  expect(report).toContain('redteam LLM ON: trap catch | not measured (n=0)');
  expect(() => renderBenchmark({...receipt,results:[result,result]})).toThrow('INVALID_BENCHMARK_RECEIPT');
  expect(() => renderBenchmark({...receipt,results:[{...result,held:true}]})).toThrow('INVALID_BENCHMARK_RECEIPT');
  expect(() => renderBenchmark({...receipt,results:[{...result,trap:true}]})).toThrow('INVALID_BENCHMARK_RECEIPT');
  result.entries[0]!.latencyMs++;
  expect(() => renderBenchmark(receipt)).toThrow('INVALID_BENCHMARK_RECEIPT');
});

it('freezes two unmodified texts from every inbox stratum without importing call cases', () => {
  const cases = benchmarkCases();
  const redteam = cases.filter(row => row.group === 'redteam');
  expect(redteam).toHaveLength(32);
  expect(new Set(redteam.map(row => row.category)).size).toBe(16);
  expect(redteam.filter(row => !row.trap).map(row => row.id)).toEqual(['RT-241','RT-242']);
});

it('OFF parses structured trap fields but cannot bypass any Northfield policy gate', async () => {
  for (const c of benchmarkCases().filter(row => row.group === 'northfield')) {
    const result = await runBenchmarkCase(c, 'OFF');
    expect(result.attempts).toEqual([]);
    expect(result.held, c.id).toBe(c.trap);
    expect(result.ruleIds, c.id).toEqual(expect.arrayContaining(c.expectedRules));
    expect(result.mockPayments, c.id).toBe(c.trap ? 0 : 1);
  }
});

it('P04 raw inbox reclassification cannot reopen an applied bank change', async () => {
  const { northfieldChange } = await import('../payables');
  const model = vi.fn(async (task, _input, schema) => ({
    output: schema!.parse(task === 'inbox_classification' ? {kind:'bank_change'} : northfieldChange('bc-legitimate').fields),
    route: 'local', model: 'mock', latencyMs: 1, costUsd: 0,
  })) as typeof route;
  const result = await runBenchmarkCase(benchmarkCases().find(row => row.id === 'P04-after-approval')!, 'ON', model);
  expect(result.status).toBe('approved'); expect(result.held).toBe(false);
  expect(result.entries.at(-1)?.action).toBe('bank_change_already_applied');
  expect(result.mockPayments).toBe(0);
});

it('the corrected valid corpus controls supply complete facts and pass real OFF policy without network calls', async () => {
  const http = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
  try {
    for (const c of benchmarkCases().filter(row => row.group === 'redteam' && !row.trap)) {
      const result = await runBenchmarkCase(c, 'OFF');
      expect(result.status, c.id).toBe('paid');
      expect(result.ruleIds).toEqual(['IN_BADGE']);
      expect(result.mockPayments).toBe(1);
    }
    expect(http).not.toHaveBeenCalled();
  } finally { http.mockRestore(); }
});

it('recovers complete structured facts after model extraction fails, without granting policy exceptions', async () => {
  const unavailable = vi.fn(async () => { throw new Error('model timeout'); }) as typeof route;
  for (const c of benchmarkCases().filter(row => row.group === 'northfield')) {
    const result = await runBenchmarkCase(c, 'ON', unavailable);
    expect(result.held, c.id).toBe(c.trap);
    expect(result.mockPayments, c.id).toBe(c.trap ? 0 : 1);
    expect(result.ruleIds, c.id).toEqual(expect.arrayContaining(c.expectedRules));
  }
});
