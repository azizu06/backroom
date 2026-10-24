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

it('OFF makes zero HTTP requests and reports legitimate fail-closed items as false holds', async () => {
  const http = vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('network forbidden'));
  const result = await runBenchmarkCase(benchmarkCases().find(row => row.id === 'P01')!, 'OFF');
  expect(http).not.toHaveBeenCalled(); http.mockRestore();
  expect(result.held).toBe(true); expect(result.calls[0]?.outcome).toBe('LLM_OFF');
  const receipt: BenchmarkReceipt = {version:1, measuredAt:'test', sourceSha:'test', hashes:{},scope:'test',results:[result]};
  const report = renderBenchmark(receipt);
  expect(report).toContain('northfield LLM OFF: false hold | 1/1 (100.00%)');
  expect(report).toContain('P01 (OFF; IN_BADGE) | held | INVALID_INPUT; FALSE HOLD');
  expect(report).toContain('redteam LLM ON: trap catch | not measured (n=0)');
  expect(() => renderBenchmark({...receipt,results:[result,result]})).toThrow('INVALID_BENCHMARK_RECEIPT');
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
