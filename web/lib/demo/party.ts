import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import { STATE_PROXY_PREFIX } from './state-proxy';

/**
 * Party mode: the host opens view-only guest listeners (Wi-Fi, Tailscale, and a loopback one behind a
 * Cloudflare quick tunnel for any network) so teammates can watch the live office. The host's own listener
 * stays where it was. Guests may load pages and assets and open the office state socket; every write
 * route is refused here, before Next.
 */
export const PARTY_PATH = '/__party';
export type PartyRole = 'host' | 'guest' | 'none';
export type PartyLinkKind = 'online' | 'wifi' | 'tailscale';
export interface PartyLink { kind: PartyLinkKind; url: string }
/** `online`: the tunnel link is still starting, or could not start (cloudflared missing or refused). */
export type PartyOnline = 'starting' | 'failed';
export interface PartyStatus { role: PartyRole; hosting?: boolean; url?: string; links?: PartyLink[]; online?: PartyOnline; guests?: number; error?: string }

const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const TOKEN_PATH = `${STATE_PROXY_PREFIX}v1/identity/websocket-token`;
// Virtual adapters (WSL, Hyper-V, VirtualBox, Docker) also carry private addresses that no teammate can reach.
const VIRTUAL = /vethernet|wsl|hyper-v|virtualbox|vbox|vmware|docker|veth|br-|loopback/i;

function lanRank(ip: string) {
  return ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : -1;
}
/** The host's Wi-Fi/Ethernet IPv4 (RFC 1918). Tailscale's 100.64/10 and virtual adapters are skipped. */
export function lanAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string | undefined {
  return Object.entries(interfaces)
    .flatMap(([name, list]) => VIRTUAL.test(name) ? [] : list ?? [])
    .filter(info => ['IPv4', '4'].includes(String(info.family)) && !info.internal && lanRank(info.address) >= 0)
    .sort((a, b) => lanRank(a.address) - lanRank(b.address))[0]?.address;
}
/** The host's Tailscale IPv4 (100.64/10). Event Wi-Fi often isolates laptops from each other; a tailnet does not. */
export function tailnetAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string | undefined {
  return Object.values(interfaces).flatMap(list => list ?? [])
    .find(info => ['IPv4', '4'].includes(String(info.family)) && !info.internal && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(info.address))?.address;
}
function defaultAddresses() {
  const wifi = lanAddress(), tailscale = tailnetAddress();
  return [...(wifi ? [{ kind: 'wifi' as const, ip: wifi }] : []), ...(tailscale ? [{ kind: 'tailscale' as const, ip: tailscale }] : [])];
}

export interface PartyTunnel { url: Promise<string>; close(): void }
const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
/** The first quick-tunnel URL cloudflared prints, or undefined. */
export function tunnelUrl(output: string): string | undefined { return TUNNEL_URL.exec(output)?.[0]; }
function cloudflaredCommand(env: NodeJS.ProcessEnv = process.env) {
  const local = join(process.cwd(), '.t8-tools', 'cloudflared', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  return env.PARTY_CLOUDFLARED || (existsSync(local) ? local : 'cloudflared');
}
/** A Cloudflare quick tunnel (no account) to one local origin. Its output never reaches status or logs. */
function cloudflaredTunnel(origin: string): PartyTunnel {
  const child = spawn(cloudflaredCommand(), ['tunnel', '--url', origin, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const url = new Promise<string>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('PARTY_TUNNEL_TIMEOUT')), 30_000);
    const read = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-8192);
      const found = tunnelUrl(output);
      if (found) { clearTimeout(timer); resolve(found); }
    };
    child.stdout.on('data', read); child.stderr.on('data', read);
    child.once('error', () => { clearTimeout(timer); reject(new Error('PARTY_TUNNEL_UNAVAILABLE')); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('PARTY_TUNNEL_EXITED')); });
  });
  url.catch(() => {});
  return { url, close: () => { child.kill(); } };
}

/** The page on the host machine itself. A tunnel also arrives on loopback, but with its public Host. */
export function hostRequest(req: Pick<IncomingMessage, 'headers' | 'socket'>, port: number): boolean {
  const host = req.headers.host;
  return LOOPBACK.includes(req.socket.remoteAddress || '') && (host === `127.0.0.1:${port}` || host === `localhost:${port}`);
}

/** What a guest may reach: page and asset reads, and the office state socket's token exchange. */
export function guestAllowed(method: string | undefined, path: string): boolean {
  if (method === 'POST') return path === TOKEN_PATH;
  if (method !== 'GET' && method !== 'HEAD') return false;
  return path === PARTY_PATH || !path.startsWith('/__');
}

function json(res: ServerResponse, body: PartyStatus, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
}
function errorCode(error: unknown) {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EADDRINUSE') return 'PARTY_PORT_IN_USE';
  return error instanceof Error && error.message.startsWith('PARTY_') ? error.message : 'PARTY_START_FAILED';
}

export type PartyHost = ReturnType<typeof createPartyHost>;
/** Optional guest listeners (Wi-Fi, Tailscale, tunnel); `handler` and `upgrade` are the host's own. */
export function createPartyHost({ handler, upgrade, port, addresses = defaultAddresses, openTunnel = cloudflaredTunnel }: {
  handler: RequestListener; upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => void; port: () => number;
  addresses?: () => { kind: Exclude<PartyLinkKind, 'online'>; ip: string }[];
  /** Opens a public tunnel to a loopback guest listener; null turns the online link off. */
  openTunnel?: ((origin: string) => PartyTunnel) | null;
}) {
  let servers: Server[] = [], links: PartyLink[] = [], tunnel: PartyTunnel | undefined, online: PartyOnline | undefined;
  const connections = new Set<Duplex>();
  // Open office state sockets, by guest address: one laptop with two tabs is one guest.
  const guests = new Map<Duplex, string>();
  const guestHandler: RequestListener = (req, res) => {
    const path = new URL(req.url || '/', 'http://party').pathname;
    if (!guestAllowed(req.method, path)) { res.writeHead(403, { 'Content-Type': 'text/plain' }).end('Guests can only view this office.'); return; }
    if (path === PARTY_PATH) { json(res, { role: 'guest' }); return; }
    handler(req, res);
  };
  const status = (): PartyStatus => ({ role: 'host', hosting: servers.length > 0, url: links[0]?.url, ...(links.length ? { links } : {}),
    ...(online ? { online } : {}), guests: new Set(guests.values()).size });
  /** `tunneled`: every request arrives from cloudflared on loopback, so the guest's address is Cloudflare's header. */
  function listen(ip: string, listenPort: number, tunneled = false) {
    const next = createServer(guestHandler);
    next.on('connection', socket => { connections.add(socket); socket.once('close', () => connections.delete(socket)); });
    next.on('upgrade', (req, socket, head) => {
      const from = tunneled ? req.headers['cf-connecting-ip'] : undefined;
      guests.set(socket, `${tunneled ? 'tunnel:' : ''}${typeof from === 'string' ? from : req.socket.remoteAddress || ''}`);
      socket.once('close', () => guests.delete(socket));
      upgrade(req, socket, head);
    });
    return new Promise<Server>((resolve, reject) => {
      next.once('error', reject);
      next.listen(listenPort, ip, () => { next.removeListener('error', reject); resolve(next); });
    });
  }
  async function start() {
    if (servers.length) return status();
    const targets = addresses();
    if (!targets.length && !openTunnel) throw new Error('PARTY_NO_LAN');
    const opened = await Promise.allSettled(targets.map(target => listen(target.ip, port())));
    const failed = opened.find(result => result.status === 'rejected');
    servers = opened.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    // All or nothing: a half-open party would show a link that does not work.
    if (failed) { await stop(); throw failed.reason; }
    links = targets.map(({ kind, ip }) => ({ kind, url: `http://${ip}:${port()}/office` }));
    if (openTunnel) await startTunnel(openTunnel);
    return status();
  }
  /** The tunnel only ever reaches its own loopback guest listener, never the host's listener. Its link arrives later. */
  async function startTunnel(open: (origin: string) => PartyTunnel) {
    const local = await listen('127.0.0.1', 0, true);
    servers.push(local);
    const current = tunnel = open(`http://127.0.0.1:${(local.address() as AddressInfo).port}`);
    online = 'starting';
    current.url.then(url => {
      if (tunnel !== current) return;
      online = undefined;
      links = [{ kind: 'online', url: `${url}/office` }, ...links];
    }, () => { if (tunnel === current) online = 'failed'; });
  }
  async function stop() {
    const current = servers;
    servers = []; links = []; online = undefined;
    tunnel?.close(); tunnel = undefined;
    if (!current.length) return status();
    const closed = Promise.all(current.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    connections.forEach(socket => socket.destroy());
    guests.clear();
    await closed;
    return status();
  }
  /** Answers /__party routes on the host's own listener; false for any other path. */
  async function route(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path !== PARTY_PATH && !path.startsWith(`${PARTY_PATH}/`)) return false;
    if (!hostRequest(req, port())) { json(res, { role: 'none' }); return true; }
    if (req.method === 'GET' && path === PARTY_PATH) { json(res, status()); return true; }
    // Changing who can connect also needs the host page's own origin: no cross-site form posts.
    const action = path === `${PARTY_PATH}/start` ? start : path === `${PARTY_PATH}/stop` ? stop : undefined;
    if (req.method !== 'POST' || !action || req.headers.origin !== `http://${req.headers.host}`) { res.writeHead(405).end(); return true; }
    try { json(res, await action()); } catch (error) { json(res, { ...status(), error: errorCode(error) }, 409); }
    return true;
  }
  return { start, stop, status, route };
}
