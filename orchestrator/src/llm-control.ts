import { timingSafeEqual } from 'node:crypto';
import { getStateStore } from './runtime';
import type { StateStore } from './store';

/** Trusted server/controller API. Never expose TOOL_GATEWAY_SECRET in a client bundle. */
export function createLlmControlHandler(options: {
  store?: () => StateStore;
  secret?: () => string | undefined;
} = {}) {
  return async (request: Request): Promise<Response> => {
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
      Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
    const secret = (options.secret ?? (() => process.env.TOOL_GATEWAY_SECRET))();
    if (!secret) return json({ error: 'GATEWAY_NOT_CONFIGURED' }, 503);
    const actual = Buffer.from(request.headers.get('authorization') ?? '');
    const expected = Buffer.from(`Bearer ${secret}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return json({ error: 'UNAUTHORIZED' }, 401);
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405, { Allow: 'GET, POST' });
    const store = (options.store ?? getStateStore)();
    if (request.method === 'POST') {
      let body: unknown;
      try { body = await request.json(); } catch { return json({ error: 'INVALID_JSON' }, 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).join(',') !== 'llmEnabled' || !('llmEnabled' in body) || typeof body.llmEnabled !== 'boolean') {
        return json({ error: 'INVALID_LLM_ENABLED' }, 400);
      }
      try { await store.setLlmEnabled(body.llmEnabled); }
      catch { return json({ error: 'STATE_UNAVAILABLE' }, 503); }
    }
    return json({ llmEnabled: store.llmEnabled });
  };
}
