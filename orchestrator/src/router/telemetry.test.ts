import { expect, it, vi } from 'vitest';
import { createRouter } from './index';

it('records local and fallback HTTP attempts without retaining finance data', async () => {
  let time = 0;
  const http = vi.fn<typeof fetch>().mockImplementation(async () => {
    time += 1000;
    return Response.json({ choices: [{ message: { content: '{"output":{},"confidence":0.2}' } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
  });
  const router = createRouter({ fetch: http, now: () => time, cloudProvider: 'openrouter', cloudApiKey: 'secret', anthropicModel: 'claude-sonnet-5-5' });
  await expect(router.route('field_extraction', { privateInvoice: 'sensitive' })).rejects.toThrow();
  expect(router.telemetry()).toMatchObject({ totalCalls: 2, localCalls: 1, localShare: 0.5,
    estimatedSavingsUsd: 0.003, pricedLocalCalls: 1, recent: { latencyMs: 1000, tokensPerSecond: 100 } });
  expect(JSON.stringify(router.telemetry())).not.toMatch(/sensitive|privateInvoice|secret/);
});

it('keeps a bounded window, ignores unknown token counts, and expires recent speed', async () => {
  vi.useFakeTimers();
  try {
    const http = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ choices: [{ message: { content: '{"output":{},"confidence":1}' } }] }));
    const router = createRouter({ fetch: http, now: () => 0 });
    for (let i = 0; i < 201; i++) await router.route('field_extraction', {});
    expect(router.telemetry()).toMatchObject({ totalCalls: 200, localCalls: 200, pricedLocalCalls: 0, estimatedSavingsUsd: null, recent: { tokensPerSecond: null } });
    vi.advanceTimersByTime(60_001);
    expect(router.telemetry().recent).toBeNull();
  } finally { vi.useRealTimers(); }
});

it('does not count health checks, OFF, or missing credentials as model HTTP attempts', async () => {
  const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ id: 'gpt-oss:20b' }] }));
  const router = createRouter({ fetch: http, cloudProvider: 'anthropic', anthropicApiKey: '' });
  await router.healthPing();
  await expect(router.route('ask_why', {})).rejects.toThrow('ANTHROPIC_API_KEY');
  expect(router.telemetry().totalCalls).toBe(0);
  const disabled = createRouter({ fetch: http, stateStore: { llmEnabled: false, llmSignal: new AbortController().signal } });
  await disabled.route('field_extraction', {});
  expect(disabled.telemetry().totalCalls).toBe(0);
});
