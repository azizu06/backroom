import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { officeConfig } from '../office/config';
import { proxyStateHTTP, proxyStateUpgrade, stateProxyTarget } from './state-proxy';

const servers: Server[] = [], sockets = new Set<Socket>();
afterEach(async () => {
  // Upgraded sockets leave the server's own connection tracking.
  sockets.forEach(socket => socket.destroy()); sockets.clear();
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});
async function listen(server: Server) {
  servers.push(server);
  server.on('connection', socket => sockets.add(socket));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}
/** A stand-in SpacetimeDB: echoes subscribe sockets and records what reached it. */
async function stateServer() {
  const seen: { url: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((req, res) => { seen.push({ url: req.url!, headers: req.headers }); res.end('{"token":"short-lived"}'); });
  server.on('upgrade', (req, socket) => {
    seen.push({ url: req.url!, headers: req.headers });
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Protocol: v2.bsatn.spacetimedb\r\n\r\n');
    socket.on('data', chunk => socket.write(chunk));
  });
  return { port: await listen(server), seen };
}
async function demoHost(env: Record<string, string>) {
  const server = createServer((req, res) => { if (!proxyStateHTTP(req, res, env)) res.writeHead(418).end(); });
  server.on('upgrade', (req, socket, head) => proxyStateUpgrade(req, socket, head, env));
  return listen(server);
}
function upgrade(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; echo?: string; protocol?: string }>((resolve, reject) => {
    const req = request({ port, host: '127.0.0.1', path, headers: { connection: 'Upgrade', upgrade: 'websocket', ...headers } });
    req.on('upgrade', (response, socket) => {
      socket.once('data', chunk => { resolve({ status: 101, echo: chunk.toString(), protocol: response.headers['sec-websocket-protocol'] as string }); socket.destroy(); });
      socket.write('frame');
    });
    req.on('response', response => { resolve({ status: response.statusCode! }); response.resume(); });
    req.on('error', reject); req.end();
  });
}

describe('same-origin state proxy', () => {
  const base = { STATE_STORE: 'spacetime', SPACETIMEDB_DATABASE: 'backroom-demo-1' };
  it('forwards only the configured database subscribe route of a private state server', () => {
    const env = { ...base, SPACETIMEDB_URI: 'ws://127.0.0.1:3010' };
    expect(stateProxyTarget('/__state/v1/database/backroom-demo-1/subscribe?compression=None', env))
      .toEqual({ hostname: '127.0.0.1', port: 3010, path: '/v1/database/backroom-demo-1/subscribe?compression=None' });
    for (const path of ['/__state/v1/database/other/subscribe', '/__state/v1/database/backroom-demo-1/sql',
      '/__state/v1/database/backroom-demo-1/call/seed_company', '/v1/database/backroom-demo-1/subscribe', '/__state/../v1/database/backroom-demo-1/subscribe']) {
      expect(stateProxyTarget(path, env)).toBeUndefined();
    }
    expect(stateProxyTarget('/__state/v1/database/backroom-demo-1/subscribe', { ...env, SPACETIMEDB_URI: 'wss://maincloud.example' })).toBeUndefined();
    expect(stateProxyTarget('/__state/v1/database/backroom-demo-1/subscribe', { ...env, STATE_STORE: 'memory' })).toBeUndefined();
  });
  it('pipes the office socket to the state server without host cookies or credentials', async () => {
    const state = await stateServer();
    const port = await demoHost({ ...base, SPACETIMEDB_URI: `ws://127.0.0.1:${state.port}` });
    const result = await upgrade(port, '/__state/v1/database/backroom-demo-1/subscribe?compression=None&token=browser-own',
      { cookie: 'backroom_session=1.secret', authorization: 'Bearer host' });
    expect(result).toEqual({ status: 101, echo: 'frame', protocol: 'v2.bsatn.spacetimedb' });
    expect(state.seen).toHaveLength(1);
    expect(state.seen[0]!.url).toBe('/v1/database/backroom-demo-1/subscribe?compression=None&token=browser-own');
    expect(state.seen[0]!.headers.cookie).toBeUndefined();
    expect(state.seen[0]!.headers.authorization).toBeUndefined();
    expect((await upgrade(port, '/__state/v1/database/backroom-demo-1/sql')).status).toBe(404);
    expect((await upgrade(port, '/api/operator/status')).status).toBe(404);
    expect(state.seen).toHaveLength(1);
  });
  it('forwards the SDK reconnect token exchange with only its bearer, and nothing else', async () => {
    const state = await stateServer();
    const port = await demoHost({ ...base, SPACETIMEDB_URI: `ws://127.0.0.1:${state.port}` });
    const exchange = await fetch(`http://127.0.0.1:${port}/__state/v1/identity/websocket-token`,
      { method: 'POST', headers: { authorization: 'Bearer browser-identity', cookie: 'backroom_session=1.secret' } });
    expect(await exchange.json()).toEqual({ token: 'short-lived' });
    expect(state.seen.map(row => [row.url, row.headers.authorization, row.headers.cookie])).toEqual([['/v1/identity/websocket-token', 'Bearer browser-identity', undefined]]);
    expect((await fetch(`http://127.0.0.1:${port}/__state/v1/identity/websocket-token`, { method: 'POST' })).status).toBe(400);
    expect((await fetch(`http://127.0.0.1:${port}/__state/v1/identity`, { method: 'POST' })).status).toBe(418);
  });
  it('points the office at the page origin only on the demo host that serves the proxy', () => {
    const env = { ...base, SPACETIMEDB_URI: 'ws://127.0.0.1:3010' };
    expect(officeConfig(env)).toEqual({ uri: 'ws://127.0.0.1:3010', database: 'backroom-demo-1' });
    expect(officeConfig({ ...env, DEMO_STATE_PROXY: '1' })).toEqual({ uri: '/__state/', database: 'backroom-demo-1' });
    expect(officeConfig({ ...env, DEMO_STATE_PROXY: '1', SPACETIMEDB_URI: 'wss://maincloud.example' })).toEqual({ uri: 'wss://maincloud.example', database: 'backroom-demo-1' });
  });
});
