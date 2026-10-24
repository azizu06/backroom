import { request, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

/**
 * The office's live-state socket, served on the web host's own origin. A browser on the
 * public https URL cannot open the host's private `ws://` SpacetimeDB address, so the
 * demo host forwards exactly two routes: the subscribe socket for the configured database,
 * and the SDK's reconnect exchange of the browser's own anonymous identity token for a
 * short-lived one. SQL, reducer-call and publish HTTP routes are not forwarded, and no
 * host cookie or server credential reaches the state server through it.
 */
export const STATE_PROXY_PREFIX = '/__state/';
type Env = Record<string, string | undefined>;

/** Only a private, non-TLS SpacetimeDB is proxied; a hosted `wss:` database is reachable directly. */
export function stateProxyEnabled(env: Env) {
  if (env.STATE_STORE !== 'spacetime' || !env.SPACETIMEDB_URI) return false;
  try { return ['ws:', 'http:'].includes(new URL(env.SPACETIMEDB_URI).protocol); } catch { return false; }
}

export function stateProxyTarget(url: string | undefined, env: Env) {
  if (!stateProxyEnabled(env) || !env.SPACETIMEDB_DATABASE) return undefined;
  const requested = new URL(url || '/', 'http://localhost');
  const path = `v1/database/${encodeURIComponent(env.SPACETIMEDB_DATABASE)}/subscribe`;
  if (requested.pathname !== `${STATE_PROXY_PREFIX}${path}`) return undefined;
  const upstream = new URL(env.SPACETIMEDB_URI!);
  return { hostname: upstream.hostname.replace(/^\[|\]$/g, ''), port: Number(upstream.port || 80), path: `/${path}${requested.search}` };
}

const TOKEN_PATH = `${STATE_PROXY_PREFIX}v1/identity/websocket-token`;
/** True when this request was a state-proxy HTTP route, answered here; false to let the app handle it. */
export function proxyStateHTTP(req: IncomingMessage, res: ServerResponse, env: Env = process.env) {
  if (new URL(req.url || '/', 'http://localhost').pathname !== TOKEN_PATH || !stateProxyEnabled(env)) return false;
  const authorization = req.headers.authorization;
  if (req.method !== 'POST' || !authorization?.startsWith('Bearer ') || authorization.length > 4096) { res.writeHead(400).end(); return true; }
  const upstream = new URL(env.SPACETIMEDB_URI!);
  const forward = request({ hostname: upstream.hostname.replace(/^\[|\]$/g, ''), port: Number(upstream.port || 80),
    path: '/v1/identity/websocket-token', method: 'POST', headers: { authorization }, timeout: 5000 }, response => {
    res.writeHead(response.statusCode || 502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.pipe(res);
  });
  forward.on('timeout', () => forward.destroy());
  forward.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  req.resume(); forward.end();
  return true;
}

/** `upgrade` listener for the demo host. Anything but the subscribe socket is refused. */
export function proxyStateUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, env: Env = process.env) {
  const target = stateProxyTarget(req.url, env);
  if (!target || req.headers.upgrade?.toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
  }
  const headers = { ...req.headers, host: `${target.hostname.includes(':') ? `[${target.hostname}]` : target.hostname}:${target.port}` };
  delete headers.cookie; delete headers.authorization;
  const upstream = request({ ...target, method: 'GET', headers });
  const close = () => { socket.destroy(); upstream.destroy(); };
  socket.on('error', close);
  upstream.on('error', () => { if (socket.writable) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); else socket.destroy(); });
  upstream.on('response', response => {
    socket.end(`HTTP/1.1 ${response.statusCode || 502} Upstream Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); response.resume();
  });
  upstream.on('upgrade', (response, state, stateHead) => {
    const lines = [`HTTP/1.1 101 ${response.statusMessage || 'Switching Protocols'}`];
    for (let i = 0; i < response.rawHeaders.length; i += 2) lines.push(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}`);
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (stateHead.length) socket.write(stateHead);
    if (head.length) state.write(head);
    state.on('error', close); state.on('close', () => socket.destroy()); socket.on('close', () => state.destroy());
    state.pipe(socket); socket.pipe(state);
  });
  upstream.end();
}
