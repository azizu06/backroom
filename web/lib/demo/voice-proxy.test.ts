import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vitest';
import { voiceRelayPath } from '../../../tools/demo/host';
import { createVoiceHandler, VoiceJournal } from '../../../orchestrator/src/voice/server';
import { APPROVAL_HOLD_MS, APPROVAL_TIMEOUT_SECS } from '../../../orchestrator/src/voice/tools';
import { proxyVoiceRelay, VOICE_RELAY_TIMEOUT_MS } from './voice-proxy';

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(s => new Promise(resolve => s.close(resolve)))); vi.restoreAllMocks(); });
async function listen(handler: RequestListener) {
  const server = createServer(handler); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}
/** The demo host's /_cartesia route in front of a relay listening on relayPort. */
const host = (relayPort: number, timeoutMs?: number) => listen((req, res) =>
  proxyVoiceRelay(req, res, voiceRelayPath(new URL(req.url || '/', 'http://localhost').pathname)!, relayPort, timeoutMs));

it('sits above every voice tool deadline and the relay approval hold', () => {
  expect(VOICE_RELAY_TIMEOUT_MS).toBeGreaterThan(APPROVAL_TIMEOUT_SECS * 1000);
  expect(VOICE_RELAY_TIMEOUT_MS).toBeGreaterThan(APPROVAL_HOLD_MS);
});

it('carries a full held check_approval through the demo host proxy without a 502', async () => {
  const journal = new VoiceJournal();
  await journal.register({ id: 'session-1', contactName: 'Jordan', welcome: 'Hi', nonce: 'nonce-1', providerCallId: 'ac-1', disclosureComplete: true, stopped: false, deliveries: {} });
  // Dana never decides, so the relay holds for the full default APPROVAL_HOLD_MS.
  const relay = createVoiceHandler({ journal, eventSecret: 'event', toolSecret: 'tool', gatewaySecret: 'gateway', approvalPollMs: 500,
    gateway: async () => Response.json({ kind: 'PENDING', can_confirm: false, approval_status: 'pending' }) });
  const relayPort = await listen(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const result = await relay(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: { authorization: String(req.headers.authorization) }, body: raw }));
    res.writeHead(result.status, { 'Content-Type': 'application/json' }).end(await result.text());
  });
  const started = Date.now();
  const response = await fetch(`http://127.0.0.1:${await host(relayPort)}/_cartesia/api/voice/tools/check_approval`, { method: 'POST',
    headers: { authorization: 'Bearer tool' }, body: JSON.stringify({ call_id: 'session-1', webhook_request_id: 'nonce-1', escalation_id: 'e1' }) });
  expect(Date.now() - started).toBeGreaterThanOrEqual(APPROVAL_HOLD_MS - 1000);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ approval_status: 'pending', next_step: 'poll_again' });
}, APPROVAL_HOLD_MS + 10_000);

it('logs a relay that outlives the proxy without request headers or body', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const relayPort = await listen(() => undefined);
  const response = await fetch(`http://127.0.0.1:${await host(relayPort, 50)}/_cartesia/api/voice/tools/check_approval`, { method: 'POST',
    headers: { authorization: 'Bearer secret-token' }, body: '{"call_id":"session-1"}' });
  expect(response.status).toBe(502);
  expect(logged).toHaveBeenCalledWith('VOICE_RELAY_PROXY_FAILED /api/voice/tools/check_approval RELAY_TIMEOUT');
  expect(JSON.stringify(logged.mock.calls)).not.toMatch(/secret-token|session-1/);
});
