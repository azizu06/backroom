import { createRouter, isLlmOff, TASK_ROUTES, type route } from '../router';
import type { StateStore } from '../store';

/** Explicit rehearsal override, never the demo's normal cloud/local routing policy.
 * Both transports are the shared GX10. No cloud request, even on timeout/schema retry.
 */
export function createGx10RehearsalRouter(state: StateStore, http: typeof fetch = fetch): typeof route {
  const base = process.env.GX10_BASE_URL ?? 'http://100.117.44.20:11434/v1';
  const address = new URL(base);
  if (!['100.117.44.20', 'gx10'].includes(address.hostname)) throw new Error('REHEARSAL_CLOUD_FORBIDDEN');
  const origin = address.origin;
  const guarded: typeof fetch = (url, init) => {
    if (new URL(String(url)).origin !== origin) throw new Error('REHEARSAL_CLOUD_FORBIDDEN');
    const body = JSON.parse(String(init?.body));
    body.reasoning_effort = 'low';
    return http(url, { ...init, body: JSON.stringify(body) });
  };
  const router = (model: string) => createRouter({ stateStore: state, localEnabled: false,
    cloudBaseUrl: base, cloudProvider: 'openrouter', cloudApiKey: 'ollama', cloudModel: model,
    cloudInputUsdPerMillion: 0, cloudOutputUsdPerMillion: 0, timeoutMs: 120000, fetch: guarded });
  const routine = router('gpt-oss:20b'), quality = router('gpt-oss:120b');
  return async (task, input, schema) => {
    const result = await (TASK_ROUTES[task] === 'local' ? routine : quality).route(task, input, schema);
    // The generic router's cloud transport points to Ollama here. Physical inference
    // is local, with zero API cost; this is an operator override, never a fallback.
    return isLlmOff(result) ? result : { ...result, route: 'local', costUsd: 0 };
  };
}
