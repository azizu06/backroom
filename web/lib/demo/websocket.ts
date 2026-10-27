import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

/** Minimal RFC 6455 server pieces shared by the office voice and screen relays (no dependency, no extensions). */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const OPCODE = { text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa } as const;

export function acceptKey(key: string): string {
  return createHash('sha1').update(key + GUID).digest('base64');
}

export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const length = payload.length;
  const header = length < 126 ? Buffer.from([0x80 | opcode, length])
    : length < 65536 ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 0xff])
    : (() => { const big = Buffer.alloc(10); big[0] = 0x80 | opcode; big[1] = 127; big.writeBigUInt64BE(BigInt(length), 2); return big; })();
  return Buffer.concat([header, payload]);
}

/**
 * Incremental reader for client frames. Browsers may split one large message into fragments (a first frame
 * without FIN, then continuation frames); they are joined here, with control frames allowed in between.
 * Returns false on a protocol violation or a message over `maxPayload`.
 */
export function createFrameReader(onMessage: (opcode: number, payload: Buffer) => void, maxPayload: number) {
  let pending: Buffer = Buffer.alloc(0);
  let partial: { opcode: number; parts: Buffer[]; size: number } | null = null;
  const onFrame = (fin: boolean, opcode: number, payload: Buffer): boolean => {
    if (opcode >= 0x8) { if (!fin) return false; onMessage(opcode, payload); return true; }
    if (opcode === 0) {
      if (!partial || (partial.size += payload.length) > maxPayload) return false;
      partial.parts.push(payload);
      if (fin) { const { opcode: first, parts } = partial; partial = null; onMessage(first, Buffer.concat(parts)); }
      return true;
    }
    if (partial) return false;
    if (fin) onMessage(opcode, payload);
    else partial = { opcode, parts: [payload], size: payload.length };
    return true;
  };
  return (chunk: Buffer): boolean => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= 2) {
      const fin = (pending[0]! & 0x80) !== 0, opcode = pending[0]! & 0x0f;
      const masked = (pending[1]! & 0x80) !== 0;
      let length = pending[1]! & 0x7f, offset = 2;
      if (length === 126) { if (pending.length < 4) return true; length = pending.readUInt16BE(2); offset = 4; }
      else if (length === 127) {
        if (pending.length < 10) return true;
        const big = pending.readBigUInt64BE(2);
        if (big > BigInt(maxPayload)) return false;
        length = Number(big); offset = 10;
      }
      if (length > maxPayload) return false;
      const total = offset + (masked ? 4 : 0) + length;
      if (pending.length < total) return true;
      const payload = Buffer.from(pending.subarray(total - length, total));
      if (masked) { const mask = pending.subarray(offset, offset + 4); for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i & 3]!; }
      pending = pending.subarray(total);
      if (!onFrame(fin, opcode, payload)) return false;
    }
    return true;
  };
}

export function relayViewer(url: string | undefined, path: string): string | undefined {
  const requested = new URL(url || '/', 'http://relay');
  if (requested.pathname !== path) return undefined;
  const viewer = requested.searchParams.get('viewer') ?? '';
  return /^[A-Za-z0-9-]{8,64}$/.test(viewer) ? viewer : undefined;
}

export interface WebSocketPeer { send(opcode: number, payload: Buffer): void; close(): void; closeFor(reason: string): void; readonly socket: Duplex; readonly backlog: number }
/**
 * Completes the handshake for `path` (false for any other path, so the caller can route it elsewhere) and
 * calls `onOpen` with the viewer id. Ping is answered and close is honoured here.
 */
export function acceptWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer, { path, maxPayload, canOpen, onOpen }: {
  path: string; maxPayload: number; canOpen: (viewer: string) => boolean;
  onOpen: (viewer: string, peer: WebSocketPeer) => { message(opcode: number, payload: Buffer): void; closed(): void };
}): boolean {
  if (new URL(req.url || '/', 'http://relay').pathname !== path) return false;
  const viewer = relayViewer(req.url, path), key = req.headers['sec-websocket-key'];
  const refuse = (status: string) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return true; };
  if (!viewer || typeof key !== 'string' || req.headers.upgrade?.toLowerCase() !== 'websocket' || req.headers['sec-websocket-version'] !== '13') return refuse('400 Bad Request');
  if (!canOpen(viewer)) return refuse('503 Full');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  let open = true;
  // RELAY_DEBUG=1 logs why relay sockets close (path, short viewer id, reason): never message content.
  const debug = (reason: string) => { if (process.env.RELAY_DEBUG === '1') console.log(`[relay] ${path} ${viewer.slice(0, 8)} closed: ${reason}`); };
  const peer: WebSocketPeer = {
    socket,
    get backlog() { return socket.writableLength; },
    send(opcode, payload) { if (open && socket.writable) socket.write(encodeFrame(opcode, payload)); },
    close() { if (open) { open = false; socket.destroy(); handlers.closed(); } },
    closeFor(reason: string) { if (open) debug(reason); peer.close(); },
  };
  const handlers = onOpen(viewer, peer);
  const read = createFrameReader((opcode, payload) => {
    if (opcode === OPCODE.ping) peer.send(OPCODE.pong, payload);
    else if (opcode === OPCODE.close) { peer.send(OPCODE.close, Buffer.alloc(0)); peer.closeFor('client closed'); }
    else handlers.message(opcode, payload);
  }, maxPayload);
  socket.on('data', chunk => { if (!read(chunk)) peer.closeFor('bad or oversized frame'); });
  socket.once('close', () => peer.closeFor('socket ended'));
  socket.on('error', () => peer.closeFor('socket error'));
  if (head.length && !read(head)) peer.closeFor('bad first frame');
  return true;
}
