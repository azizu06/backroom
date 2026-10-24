import { expect, it } from 'vitest';
import { MemoryStateStore } from './store';
import { createLlmControlHandler } from './llm-control';

it('authenticates reads and writes, validates exact boolean input, and shares router state', async () => {
  const store = new MemoryStateStore();
  const handler = createLlmControlHandler({ store: () => store, secret: () => 'test-secret' });
  const request = (method: string, body?: string, authorized = true) => new Request('https://test/api/llm', {
    method, headers: authorized ? { Authorization: 'Bearer test-secret' } : {}, body,
  });
  expect((await handler(request('GET', undefined, false))).status).toBe(401);
  expect((await handler(request('POST', '{"llmEnabled":false}', false))).status).toBe(401);
  expect(store.llmEnabled).toBe(true);
  for (const body of ['{', '{}', '{"llmEnabled":"false"}', '{"llmEnabled":false,"extra":true}']) {
    expect((await handler(request('POST', body))).status).toBe(400);
  }
  const off = await handler(request('POST', '{"llmEnabled":false}'));
  expect(await off.json()).toEqual({ llmEnabled: false });
  expect(off.headers.get('cache-control')).toBe('no-store');
  expect(store.llmEnabled).toBe(false);
  expect(await (await handler(request('GET'))).json()).toEqual({ llmEnabled: false });
  expect((await store.listAudit()).at(-1)).toMatchObject({ actor: 'code', action: 'set_llm_enabled', inputs: { llmEnabled: false } });
  expect((await handler(request('DELETE'))).status).toBe(405);
  expect((await createLlmControlHandler({ store: () => store, secret: () => undefined })(request('GET'))).status).toBe(503);
});
