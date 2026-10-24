import { expect, it } from 'vitest';
import { generateMonth, runBurst } from './index';

it('processes independent companies with bounded GX10-only requests and durable progress', async () => {
  let active = 0, peak = 0;
  const urls: string[] = [];
  const http: typeof fetch = async (url, init) => {
    urls.push(String(url));
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    const body = JSON.parse(String(init?.body));
    const input = JSON.parse(body.messages[1].content);
    const output = input.expectedKind ? JSON.parse(input.document.text.split('\nInvoice data: ')[1].split('\n')[0]) : { kind: 'invoice' };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ output, confidence: 1 }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  };
  const receipts: unknown[] = [];
  const manifest = generateMonth(2, '2026-09').filter(row => ['4401', '4419', '4471'].includes(row.invoiceId));
  const result = await runBurst(manifest, { concurrency: 2, http, emit: row => { receipts.push(row); } });
  expect(result.completed).toBe(6);
  expect(result.failedItems).toBe(0);
  expect(result.trapsCaught).toBe(4);
  expect(result.trapRuleMatches).toBe(4);
  expect(result.simulatedPayments).toBe(2);
  expect(result.localShare).toBe(1);
  expect(result.promptTokens).toBe(1200);
  expect(result.completionTokens).toBe(240);
  expect(peak).toBe(2);
  expect(urls.every(url => url === 'http://100.117.44.20:11434/v1/chat/completions')).toBe(true);
  expect(receipts.length).toBeGreaterThan(6);
});

it('holds failed model work without a cloud request or invented token/cost metrics', async () => {
  const urls: string[] = [];
  const http: typeof fetch = async url => { urls.push(String(url)); return new Response('{}', { status: 503 }); };
  const result = await runBurst(generateMonth(1, '2026-09').filter(row => row.invoiceId === '4471'), {
    concurrency: 1, http, emit() {}, inputUsdPerMillion: 3, outputUsdPerMillion: 15,
  });
  expect(urls).toEqual(['http://100.117.44.20:11434/v1/chat/completions']);
  expect(result.failedItems).toBe(1);
  expect(result.failedTasks).toBe(1);
  expect(result.simulatedPayments).toBe(0);
  expect(result.trapsCaught).toBe(1);
  expect(result.trapRuleMatches).toBe(0);
  expect(result.tokensPerSecond).toBeNull();
  expect(result.cloudEquivalentAvoidedUsd).toBeNull();
  expect(result.localShare).toBeNull();
});

it('rejects malformed local extraction and counts schema attempts without cloud transport', async () => {
  let count = 0;
  const result = await runBurst(generateMonth(1, '2026-09').filter(row => row.invoiceId === '4471'), {
    concurrency: 1, emit() {}, http: async (_url, init) => {
      expect(init?.redirect).toBe('error'); count++;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"output":{"approved":true},"confidence":1}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    }, inputUsdPerMillion: 3, outputUsdPerMillion: 15,
  });
  expect(count).toBe(2);
  expect(result.failedTasks).toBe(1);
  expect(result.promptTokens).toBe(20);
  expect(result.cloudEquivalentAvoidedUsd).toBeCloseTo(0.00021);
  expect(result.trapRuleMatches).toBe(0);
});

it('generates a reproducible month and validates workload bounds before network work', async () => {
  const manifest = generateMonth(25, '2026-02');
  expect(manifest).toHaveLength(925);
  expect(new Set(manifest.map(row => row.item.id)).size).toBe(925);
  expect(manifest.every(row => row.date.startsWith('2026-02-'))).toBe(true);
  expect(generateMonth(25, '2026-02')).toEqual(manifest);
  expect(() => generateMonth(0, '2026-09')).toThrow();
  expect(() => generateMonth(1, '2026-13')).toThrow();
  await expect(runBurst([], { concurrency: 9, emit() {} })).rejects.toThrow();
});

it('keeps every planted Northfield rule hold through the real payables seat', async () => {
  const manifest = generateMonth(1, '2026-09').filter(row => row.expectedRule);
  const result = await runBurst(manifest, { concurrency: 1, emit() {}, http: async (_url, init) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    const fields = JSON.parse(input.document.text.split('\nInvoice data: ')[1].split('\n')[0]);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      output: input.expectedKind ? fields : { kind: 'invoice' }, confidence: 1,
    }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  } });
  expect(result.trapsTotal).toBe(8);
  expect(result.trapsCaught).toBe(8);
  expect(result.trapRuleMatches).toBe(8);
  expect(result.simulatedPayments).toBe(0);
  expect(result.failedItems).toBe(0);
});
