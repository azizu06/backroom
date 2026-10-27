import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { OPCODE, acceptWebSocket, createFrameReader as createReader, relayViewer, type WebSocketPeer } from './websocket';

export { acceptKey, encodeFrame } from './websocket';

/**
 * Proximity voice relay for the office: a minimal WebSocket fan-out on the demo host's own listeners, so voice
 * crosses the same links as the page (Wi-Fi, Tailscale, the party tunnel) with no peer-to-peer NAT traversal.
 * Each binary frame is 20 ms of 16 kHz mono PCM; receivers set loudness from avatar distance. Audio is never
 * stored, logged or given to a model: human chat is not agent input (AGENTS.md §8).
 */
export const VOICE_PATH = '/__voice';
export const VOICE_MAX_PEERS = 12;
/** One chunk is 640 bytes; anything far larger is not this client. */
const MAX_PAYLOAD = 8192;
/** About 1.5x one live speaker (32 kB/s); excess audio is dropped, never queued. */
const MAX_BYTES_PER_SECOND = 48_000;
/** A listener this far behind is skipped rather than buffered. */
const MAX_BACKLOG = 256 * 1024;

export const voiceViewer = (url: string | undefined) => relayViewer(url, VOICE_PATH);
export const createFrameReader = (onFrame: (opcode: number, payload: Buffer) => void) => createReader(onFrame, MAX_PAYLOAD);

/** What listeners receive: [id length][sender id][PCM]. */
export function relayPacket(senderId: string, pcm: Buffer): Buffer {
  const id = Buffer.from(senderId, 'utf8');
  return Buffer.concat([Buffer.from([id.length]), id, pcm]);
}

interface Speaker { id: string; peer: WebSocketPeer; windowAt: number; bytes: number }

export function createVoiceRelay(clock: () => number = Date.now) {
  const speakers = new Set<Speaker>();
  function fanOut(from: Speaker, pcm: Buffer) {
    const now = clock();
    if (now - from.windowAt >= 1000) { from.windowAt = now; from.bytes = 0; }
    from.bytes += pcm.length;
    if (from.bytes > MAX_BYTES_PER_SECOND || pcm.length === 0 || pcm.length % 2) return;
    const packet = relayPacket(from.id, pcm);
    for (const speaker of speakers) if (speaker !== from && speaker.peer.backlog < MAX_BACKLOG) speaker.peer.send(OPCODE.binary, packet);
  }
  /** Handles an upgrade to VOICE_PATH; false for any other path, so the caller can route it elsewhere. */
  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    return acceptWebSocket(req, socket, head, {
      path: VOICE_PATH, maxPayload: MAX_PAYLOAD,
      canOpen: id => {
        // A reconnect from the same viewer replaces its old socket.
        for (const speaker of [...speakers]) if (speaker.id === id) speaker.peer.closeFor('replaced by a newer connection with the same viewer id');
        return speakers.size < VOICE_MAX_PEERS;
      },
      onOpen: (id, peer) => {
        const speaker: Speaker = { id, peer, windowAt: clock(), bytes: 0 };
        speakers.add(speaker);
        return { message: (opcode, payload) => { if (opcode === OPCODE.binary) fanOut(speaker, payload); }, closed: () => speakers.delete(speaker) };
      },
    });
  }
  function close() { for (const speaker of [...speakers]) speaker.peer.close(); }
  return { upgrade, close, size: () => speakers.size };
}
