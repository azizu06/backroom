import { expect, it, vi } from 'vitest';
import { createRouter } from './index';
import { MemoryStateStore } from '../store';

const anthropic = () => Response.json({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 },
  content: [{ type: 'text', text: JSON.stringify({ output: { ok: true }, confidence: 0.8 }) }] });

it('fallback() goes straight to the cloud, labelled cloud_fallback, with cost', async () => {
  const http = vi.fn<typeof fetch>(async url => String(url).startsWith('https://api.anthropic.com/') ? anthropic() : Response.json({}));
  const router = createRouter({ stateStore: new MemoryStateStore(), anthropicApiKey: 'test', fetch: http });
  const result = await router.fallback('field_extraction', 'invoice text');
  expect(result).toMatchObject({ route: 'cloud_fallback', model: 'claude-sonnet-5-5', output: { ok: true } });
  expect('costUsd' in result && result.costUsd).toBeCloseTo((100 * 2 + 50 * 10) / 1e6);
  expect(http.mock.calls.map(([url]) => new URL(String(url)).host)).toEqual(['api.anthropic.com']);
});

it('fallback() honours the OFF switch and rejects cloud tasks and vision', async () => {
  const state = new MemoryStateStore();
  await state.setLlmEnabled(false);
  const http = vi.fn<typeof fetch>();
  const router = createRouter({ stateStore: state, anthropicApiKey: 'test', fetch: http });
  expect(await router.fallback('field_extraction', 'x')).toMatchObject({ kind: 'LLM_OFF' });
  await expect(router.fallback('ask_why', 'x')).rejects.toThrow('Cloud fallback unsupported');
  await expect(router.fallback('document_extraction', 'x')).rejects.toThrow('Cloud fallback unsupported');
  expect(http).not.toHaveBeenCalled();
});

it('fallback() rejects low-confidence cloud output like route()', async () => {
  const http: typeof fetch = async () => Response.json({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: 'text', text: JSON.stringify({ output: {}, confidence: 0.69 }) }] });
  const router = createRouter({ stateStore: new MemoryStateStore(), anthropicApiKey: 'test', fetch: http });
  await expect(router.fallback('field_extraction', 'x')).rejects.toThrow('confidence too low');
});

it('fallback() never starts a cloud request for a caller that is already cancelled', async () => {
  const http = vi.fn<typeof fetch>();
  const router = createRouter({ stateStore: new MemoryStateStore(), anthropicApiKey: 'test', fetch: http });
  const controller = new AbortController();
  controller.abort('CANCELLED');
  expect(await router.fallback('field_extraction', 'x', undefined, { signal: controller.signal })).toMatchObject({ kind: 'LLM_OFF' });
  expect(http).not.toHaveBeenCalled();
});

it('fallback() aborts an in-flight cloud request when the caller cancels', async () => {
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  const http: typeof fetch = async (_url, init) => { seen = init?.signal ?? undefined; controller.abort('CANCELLED'); throw new DOMException('aborted', 'AbortError'); };
  const router = createRouter({ stateStore: new MemoryStateStore(), anthropicApiKey: 'test', fetch: http });
  expect(await router.fallback('field_extraction', 'x', undefined, { signal: controller.signal })).toMatchObject({ kind: 'LLM_OFF' });
  expect(seen?.aborted).toBe(true);
});
