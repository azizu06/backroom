import { describe, expect, it } from 'vitest';
import { operatorSession, operatorSessionValid, operatorOriginAllowed, localOperatorRequest } from './session';

const env = { DEMO_CONTROL_SECRET: 'private-host-key', DEMO_PORT: '3397', DEMO_PUBLIC_URL: 'https://demo.example' };
describe('operator authorization', () => {
  it('requires an unexpired host-bound HttpOnly session, not a caller supplied bearer', () => {
    const cookie = operatorSession(env, 'http://127.0.0.1:3397', 1000);
    expect(cookie).toContain('HttpOnly; SameSite=Strict');
    const request = new Request('http://127.0.0.1:3397/api/operator/status', { headers: { cookie } });
    expect(operatorSessionValid(request, env, 1001)).toBe(true);
    expect(operatorSessionValid(request, { ...env, DEMO_CONTROL_SECRET: 'other-host' }, 1001)).toBe(false);
    expect(operatorSessionValid(request, env, 30_000_001)).toBe(false);
    expect(operatorSessionValid(new Request(request.url, { headers: { authorization: 'Bearer private-host-key' } }), env)).toBe(false);
  });
  it('rejects missing, foreign and forwarded origins even with a valid cookie', () => {
    for (const origin of [undefined, 'https://evil.example']) {
      const request = new Request('https://demo.example/api/operator/reset', { method: 'POST', headers: origin ? { origin } : {} });
      expect(operatorOriginAllowed(request, env)).toBe(false);
    }
    expect(operatorOriginAllowed(new Request('https://evil.example/api/operator/reset', { method: 'POST', headers: {
      origin: 'https://evil.example', 'x-forwarded-host': 'demo.example',
    } }), env)).toBe(false);
    expect(operatorOriginAllowed(new Request('https://demo.example/api/operator/reset', { method: 'POST', headers: { origin: 'https://demo.example' } }), env)).toBe(true);
  });
  it('bootstraps only on the private numeric loopback host, never through the public tunnel', () => {
    expect(localOperatorRequest('127.0.0.1', '127.0.0.1:3397', 'http://127.0.0.1:3397', 3397)).toBe(true);
    expect(localOperatorRequest('127.0.0.1', 'demo.example', 'https://demo.example', 3397)).toBe(false);
    expect(localOperatorRequest('192.168.1.2', '127.0.0.1:3397', 'http://127.0.0.1:3397', 3397)).toBe(false);
    expect(localOperatorRequest('127.0.0.1', '127.0.0.1:3397', 'https://evil.example', 3397)).toBe(false);
  });
});
