import { afterEach, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { createPartyHost, guestAllowed, hostRequest, lanAddress, tailnetAddress, tunnelUrl, type PartyHost, type PartyTunnel } from './party';

const ipv4 = (address: string, internal = false) => ({ address, family: 'IPv4' as const, internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null });

it('picks the Wi-Fi address and skips loopback, Tailscale and virtual adapters', () => {
  expect(lanAddress({
    'Loopback Pseudo-Interface 1': [ipv4('127.0.0.1', true)],
    'vEthernet (WSL)': [ipv4('172.24.16.1')],
    VirtualBox: [ipv4('192.168.56.1')],
    Tailscale: [ipv4('100.97.81.61')],
    'Wi-Fi': [ipv4('10.0.0.42'), { ...ipv4('fe80::1'), family: 'IPv6' as const, scopeid: 0 }],
  })).toBe('10.0.0.42');
  expect(lanAddress({ eth0: [ipv4('172.20.1.5')], wlan0: [ipv4('192.168.1.20')] })).toBe('192.168.1.20');
  expect(lanAddress({ Tailscale: [ipv4('100.97.81.61')] })).toBeUndefined();
  expect(tailnetAddress({ 'Wi-Fi': [ipv4('10.0.0.42')], Tailscale: [ipv4('100.97.81.61')] })).toBe('100.97.81.61');
  expect(tailnetAddress({ 'Wi-Fi': [ipv4('100.200.1.1')] })).toBeUndefined();
});

it('lets guests read pages and open the state socket, and nothing else', () => {
  for (const path of ['/office', '/_next/static/chunks/a.js', '/api/payment-link', '/__party']) expect(guestAllowed('GET', path)).toBe(true);
  expect(guestAllowed('POST', '/__state/v1/identity/websocket-token')).toBe(true);
  for (const [method, path] of [['POST', '/api/inbox'], ['POST', '/office'], ['PUT', '/office'], ['DELETE', '/api/x'], ['GET', '/__demo/status'],
    ['GET', '/__operator/session'], ['POST', '/__party/start'], ['GET', '/__state/v1/database/demo/sql']] as const) expect(guestAllowed(method, path)).toBe(false);
});

it('treats only a loopback socket with a loopback Host as the host machine', () => {
  const req = (remoteAddress: string, host: string) => ({ headers: { host }, socket: { remoteAddress } }) as never;
  expect(hostRequest(req('127.0.0.1', 'localhost:3000'), 3000)).toBe(true);
  expect(hostRequest(req('::1', '127.0.0.1:3000'), 3000)).toBe(true);
  expect(hostRequest(req('127.0.0.1', 'demo.trycloudflare.com'), 3000)).toBe(false);
  expect(hostRequest(req('192.168.1.30', 'localhost:3000'), 3000)).toBe(false);
});

const servers: Server[] = [], sockets = new Set<Socket>();
let party: PartyHost | undefined;
afterEach(async () => {
  await party?.stop(); party = undefined;
  sockets.forEach(socket => socket.destroy()); sockets.clear();
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});
function call(host: string, port: number, path: string, method = 'GET', headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host, port, path, method, headers }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode!, body }));
    });
    req.on('error', reject); req.end();
  });
}

/** The host on 127.0.0.1 and the party on ::1 share one port, like the host's loopback and Wi-Fi listeners. */
async function hostAndParty(tunnel: ((origin: string) => PartyTunnel) | null = null) {
  const seen: string[] = [];
  const handler = (req: { method?: string; url?: string }, res: { end(body: string): void }) => { seen.push(`${req.method} ${req.url}`); res.end('app'); };
  let port = 0;
  party = createPartyHost({ handler: handler as never, upgrade: (_req, socket) => socket.destroy(), port: () => port, addresses: () => [{ kind: 'wifi', ip: '::1' }], openTunnel: tunnel });
  const current = party;
  const host = createServer(async (req, res) => { if (!await current.route(req, res)) handler(req, res); });
  host.on('connection', socket => sockets.add(socket));
  servers.push(host);
  await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
  port = (host.address() as AddressInfo).port;
  return { port, seen, origin: { origin: `http://localhost:${port}`, host: `localhost:${port}` } };
}

it('starts and stops a view-only guest listener from the host page', async () => {
  const { port, seen, origin } = await hostAndParty();
  expect(JSON.parse((await call('127.0.0.1', port, '/__party', 'GET', { host: `localhost:${port}` })).body)).toEqual({ role: 'host', hosting: false, guests: 0 });
  // A tunnel arrives on loopback with its public Host, and a cross-site post has another Origin.
  expect(JSON.parse((await call('127.0.0.1', port, '/__party', 'GET', { host: 'demo.example' })).body)).toEqual({ role: 'none' });
  expect((await call('127.0.0.1', port, '/__party/start', 'POST', { ...origin, origin: 'https://evil.example' })).status).toBe(405);

  const started = JSON.parse((await call('127.0.0.1', port, '/__party/start', 'POST', origin)).body);
  expect(started).toEqual({ role: 'host', hosting: true, url: `http://::1:${port}/office`, links: [{ kind: 'wifi', url: `http://::1:${port}/office` }], guests: 0 });
  expect(await call('::1', port, '/office')).toEqual({ status: 200, body: 'app' });
  expect(JSON.parse((await call('::1', port, '/__party')).body)).toEqual({ role: 'guest' });
  expect((await call('::1', port, '/api/inbox', 'POST')).status).toBe(403);
  expect((await call('::1', port, '/__party/start', 'POST', origin)).status).toBe(403);
  expect(seen).toEqual(['GET /office']);

  expect(JSON.parse((await call('127.0.0.1', port, '/__party/stop', 'POST', origin)).body)).toEqual({ role: 'host', hosting: false, guests: 0 });
  await expect(call('::1', port, '/office')).rejects.toThrow();
});

it('reports why hosting could not start', async () => {
  const { port, origin } = await hostAndParty();
  const blocker = createServer(); servers.push(blocker);
  await new Promise<void>(resolve => blocker.listen(port, '::1', resolve));
  const reply = await call('127.0.0.1', port, '/__party/start', 'POST', origin);
  expect(reply.status).toBe(409);
  expect(JSON.parse(reply.body)).toMatchObject({ hosting: false, error: 'PARTY_PORT_IN_USE' });
});

it('finds the quick-tunnel URL in cloudflared output', () => {
  expect(tunnelUrl('INF |  https://able-baker-charlie.trycloudflare.com  |')).toBe('https://able-baker-charlie.trycloudflare.com');
  expect(tunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...')).toBeUndefined();
});

it('puts the online link first, and the tunnel reaches only its own view-only listener', async () => {
  let origin = '', closed = false, publish!: (url: string) => void;
  const { port, seen, origin: hostOrigin } = await hostAndParty(local => {
    origin = local;
    return { url: new Promise<string>(resolve => { publish = resolve; }), close: () => { closed = true; } };
  });
  const started = JSON.parse((await call('127.0.0.1', port, '/__party/start', 'POST', hostOrigin)).body);
  expect(started).toMatchObject({ hosting: true, online: 'starting', url: `http://::1:${port}/office` });
  // The tunnel's origin is a separate loopback listener: never the host's port, and guest rules apply on it.
  const tunnelPort = Number(new URL(origin).port);
  expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  expect(tunnelPort).not.toBe(port);
  expect(JSON.parse((await call('127.0.0.1', tunnelPort, '/__party', 'GET', { host: 'able-baker.trycloudflare.com' })).body)).toEqual({ role: 'guest' });
  expect((await call('127.0.0.1', tunnelPort, '/__party/stop', 'POST', { host: `localhost:${tunnelPort}`, origin: `http://localhost:${tunnelPort}` })).status).toBe(403);
  expect((await call('127.0.0.1', tunnelPort, '/office')).body).toBe('app');

  publish('https://able-baker.trycloudflare.com');
  await new Promise(resolve => setTimeout(resolve, 0));
  const ready = JSON.parse((await call('127.0.0.1', port, '/__party', 'GET', { host: `localhost:${port}` })).body);
  expect(ready.url).toBe('https://able-baker.trycloudflare.com/office');
  expect(ready.links.map((link: { kind: string }) => link.kind)).toEqual(['online', 'wifi']);
  expect(ready.online).toBeUndefined();
  expect(seen).toEqual(['GET /office']);

  await call('127.0.0.1', port, '/__party/stop', 'POST', hostOrigin);
  expect(closed).toBe(true);
  await expect(call('127.0.0.1', tunnelPort, '/office')).rejects.toThrow();
});

it('keeps the local links when the tunnel cannot start', async () => {
  const { port, origin } = await hostAndParty(() => ({ url: Promise.reject(new Error('PARTY_TUNNEL_UNAVAILABLE')), close() {} }));
  await call('127.0.0.1', port, '/__party/start', 'POST', origin);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(JSON.parse((await call('127.0.0.1', port, '/__party', 'GET', { host: `localhost:${port}` })).body))
    .toMatchObject({ hosting: true, online: 'failed', url: `http://::1:${port}/office` });
});
