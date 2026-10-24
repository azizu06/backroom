import { expect, it, vi } from 'vitest';
import { createDemoVoiceBridge } from './demo-bridge';
it('registers privately and relays tools into demo state with a public speakable payment URL', async () => {
  const network = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/send_payment_link')) return Response.json({ kind: 'RECORDED', short_code: 'AB12CD3456', amount_cents: 247500 });
    return Response.json({ ok: true, stopped: false });
  });
  const bridge = createDemoVoiceBridge({ port: 3000, controlSecret: 'private-control', publicOrigin: 'https://demo.example', fetch: network });
  await bridge.register('session-id');
  expect(network.mock.calls[0]).toMatchObject(['http://127.0.0.1:3000/__demo/voice-call', { headers: { authorization: 'Bearer private-control' }, body: '{"sessionId":"session-id"}' }]);
  expect(await bridge.clientStopped()).toBe(false);
  const response = await bridge.gateway('send_payment_link', new Request('http://internal', { method: 'POST', headers: { authorization: 'Bearer gateway' }, body: '{}' }));
  expect(await response.json()).toMatchObject({ payment_url: 'https://demo.example/p/AB12CD3456', amount_cents: 247500,
    speak: expect.stringContaining('A B 1 2 C D 3 4 5 6') });
  expect(network.mock.calls[2]![1]?.headers).toBeInstanceOf(Headers);
  await bridge.endCall('session-id');
  expect(network.mock.calls.at(-1)).toMatchObject(['http://127.0.0.1:3000/__demo/voice-call-ended', { body: '{"sessionId":"session-id"}' }]);
  expect(() => createDemoVoiceBridge({ port: 3000, controlSecret: 'secret', publicOrigin: 'http://localhost:3000' })).toThrow('PUBLIC_HTTPS_ORIGIN_REQUIRED');
});
it('fails closed when shared registration is unavailable', async () => {
  const bridge = createDemoVoiceBridge({ port: 3000, controlSecret: 'private', publicOrigin: 'https://demo.example', fetch: async () => new Response('', { status: 503 }) });
  await expect(bridge.register('session')).rejects.toThrow('DEMO_VOICE_STATE_UNAVAILABLE');
});
