import { createHash, timingSafeEqual } from 'node:crypto';
import { attackInput, ATTACK_PRESETS, runAttackDemo } from './index';
import { AttackDemoError, createLiveAnalyst } from './live';

const BODY_LIMIT = 65536;
export function createAttackDemoHandler(options: {
  secret?: () => string | undefined;
  analyst?: ReturnType<typeof createLiveAnalyst>;
} = {}) {
  const analyst = options.analyst ?? createLiveAnalyst();
  return async (request: Request): Promise<Response> => {
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    const secret = (options.secret ?? (() => process.env.TOOL_GATEWAY_SECRET))();
    if (!secret) return json({ error: 'GATEWAY_NOT_CONFIGURED' }, 503);
    const hash = (value: string) => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(hash(request.headers.get('authorization') ?? ''), hash(`Bearer ${secret}`))) return json({ error: 'UNAUTHORIZED' }, 401);
    if (new URL(request.url).pathname !== '/api/attack-demo') return json({ error: 'NOT_FOUND' }, 404);
    if (request.method === 'GET') return json({ presets: ATTACK_PRESETS, defaultMode: 'mock' });
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    let body: unknown;
    try {
      const reader = request.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > BODY_LIMIT) { await reader.cancel(); return json({ error: 'BODY_TOO_LARGE' }, 413); }
          chunks.push(value);
        }
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { return json({ error: 'INVALID_JSON' }, 400); }
    const parsed = attackInput.safeParse(body);
    if (!parsed.success) return json({ error: 'INVALID_ATTACK_INPUT' }, 400);
    try { return json(await runAttackDemo(parsed.data, { analyst })); }
    catch (error) {
      return json({ error: error instanceof AttackDemoError ? error.message : 'ATTACK_DEMO_UNAVAILABLE' },
        error instanceof AttackDemoError ? error.status : 503);
    }
  };
}
