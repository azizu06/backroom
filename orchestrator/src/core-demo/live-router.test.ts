import { expect, it, vi } from 'vitest';
import { MemoryStateStore } from '../store';
import { createGx10RehearsalRouter } from './live-router';

it('routes hard tasks only to GX10 and labels the physical local inference honestly', async () => {
  const http = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => Response.json({ choices: [{ message: { content: JSON.stringify({ output: { answer: 'cited' }, confidence: 1 }) } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }));
  const router = createGx10RehearsalRouter(new MemoryStateStore(), http);
  const result = await router('ask_why', {}, { parse: value => value });
  expect(result).toMatchObject({ route: 'local', model: 'gpt-oss:120b', costUsd: 0, output: { answer: 'cited' } });
  expect(http).toHaveBeenCalledTimes(1);
  expect(String(http.mock.calls[0]?.[0])).toBe('http://100.117.44.20:11434/v1/chat/completions');
});

it('LLM OFF suppresses hard and routine rehearsal calls', async () => {
  const store = new MemoryStateStore(); await store.setLlmEnabled(false);
  const http = vi.fn(async () => { throw new Error('NETWORK_FORBIDDEN'); });
  const router = createGx10RehearsalRouter(store, http);
  for (const task of ['call_plan', 'field_extraction'] as const) expect(await router(task, {})).toMatchObject({ kind: 'LLM_OFF' });
  expect(http).not.toHaveBeenCalled();
});

it('refuses a cloud URL accidentally configured as the GX10 base', () => {
  vi.stubEnv('GX10_BASE_URL', 'https://openrouter.ai/api/v1');
  try { expect(() => createGx10RehearsalRouter(new MemoryStateStore())).toThrow('REHEARSAL_CLOUD_FORBIDDEN'); }
  finally { vi.unstubAllEnvs(); }
});
