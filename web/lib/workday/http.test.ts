import { afterEach, expect, it, vi } from 'vitest';
import { workdayHTTP } from './http';
import { operatorSessionCookie } from '../operator/sign-in';
import { getStateStore } from '@backroom/orchestrator';
const origin = 'http://127.0.0.1:3057';
afterEach(async () => { await getStateStore().setLlmEnabled(true); vi.unstubAllEnvs(); });
it('requires an operator session and exact origin before checking or starting a batch', async () => {
  vi.stubEnv('DEMO_PORT', '3057');
  vi.stubEnv('CONTROLLER_ENROLLMENT_SECRET', 'workday-test');
  const cookie = operatorSessionCookie('workday-test', origin);
  const post = (headers: Record<string, string>) => new Request(`${origin}/api/operator/workday`, { method: 'POST', headers });
  expect((await workdayHTTP(post({ origin }))).status).toBe(401);
  expect((await workdayHTTP(post({ origin: 'https://foreign.example', cookie }))).status).toBe(403);
  await getStateStore().setLlmEnabled(false);
  const off = await workdayHTTP(post({ origin, cookie }));
  expect(off.status).toBe(409);
  expect(await off.json()).toMatchObject({ error: expect.stringContaining('OFF') });
});
