import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { OPCODE, acceptWebSocket, type WebSocketPeer } from './websocket';
import { OPEN_SEATS, type ScreenSeat } from '../office/screens';

/**
 * Desk screen-share relay on the demo host. A viewer claims an open desk (one person per desk, one desk per
 * person) and sends JPEG snapshots; only viewers who say they are watching that desk receive them. Seats are
 * broadcast to everyone. Images are kept in memory only as the latest frame per desk: never stored, logged or
 * given to a model (AGENTS.md §8).
 */
export const SCREEN_PATH = '/__screen';
const MAX_PEERS = 16;
const MAX_IMAGE = 512 * 1024;
const MAX_FRAMES_PER_SECOND = 4;
/** A watcher this far behind skips frames rather than buffering them. */
const MAX_BACKLOG = 2 * 1024 * 1024;

interface Viewer { id: string; peer: WebSocketPeer; desk?: number; name: string; watching: Set<number>; frames: number[] }

export function createScreenRelay(clock: () => number = Date.now) {
  const viewers = new Set<Viewer>();
  const latest = new Map<number, Buffer>();
  const seats = (): ScreenSeat[] => [...viewers].flatMap(v => v.desk === undefined ? [] : [{ desk: v.desk, viewerId: v.id, name: v.name }]);
  const text = (viewer: Viewer, body: unknown) => viewer.peer.send(OPCODE.text, Buffer.from(JSON.stringify(body)));
  const broadcastSeats = () => { const body = { type: 'seats', seats: seats() }; for (const viewer of viewers) text(viewer, body); };
  const framePacket = (desk: number, jpeg: Buffer) => Buffer.concat([Buffer.from([desk]), jpeg]);
  function stand(viewer: Viewer) {
    if (viewer.desk === undefined) return;
    latest.delete(viewer.desk);
    viewer.desk = undefined;
    broadcastSeats();
  }
  function control(viewer: Viewer, raw: Buffer) {
    let message: Record<string, unknown>;
    try { message = JSON.parse(raw.toString('utf8')); } catch { return; }
    if (message.type === 'sit' && typeof message.desk === 'number' && OPEN_SEATS.includes(message.desk)) {
      if ([...viewers].some(other => other !== viewer && other.desk === message.desk)) { text(viewer, { type: 'error', code: 'SEAT_TAKEN' }); return; }
      viewer.name = typeof message.name === 'string' ? message.name.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 24) || 'Viewer' : 'Viewer';
      if (viewer.desk !== undefined) latest.delete(viewer.desk);
      viewer.desk = message.desk;
      broadcastSeats();
    } else if (message.type === 'stand') stand(viewer);
    else if (message.type === 'watch' && Array.isArray(message.desks)) {
      const next = new Set(message.desks.filter((desk): desk is number => typeof desk === 'number' && OPEN_SEATS.includes(desk)).slice(0, OPEN_SEATS.length));
      // A newly watched desk gets its latest image at once, so the monitor never waits half a second blank.
      for (const desk of next) if (!viewer.watching.has(desk) && latest.has(desk)) viewer.peer.send(OPCODE.binary, framePacket(desk, latest.get(desk)!));
      viewer.watching = next;
    }
  }
  function frame(viewer: Viewer, jpeg: Buffer) {
    const desk = viewer.desk, now = clock();
    if (desk === undefined || jpeg.length === 0) return;
    viewer.frames = viewer.frames.filter(at => now - at < 1000);
    if (viewer.frames.length >= MAX_FRAMES_PER_SECOND) return;
    viewer.frames.push(now);
    latest.set(desk, jpeg);
    const packet = framePacket(desk, jpeg);
    for (const other of viewers) if (other !== viewer && other.watching.has(desk) && other.peer.backlog < MAX_BACKLOG) other.peer.send(OPCODE.binary, packet);
  }
  function upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    return acceptWebSocket(req, socket, head, {
      path: SCREEN_PATH, maxPayload: MAX_IMAGE,
      canOpen: id => {
        for (const viewer of [...viewers]) if (viewer.id === id) viewer.peer.closeFor('replaced by a newer connection with the same viewer id');
        return viewers.size < MAX_PEERS;
      },
      onOpen: (id, peer) => {
        const viewer: Viewer = { id, peer, name: 'Viewer', watching: new Set(), frames: [] };
        viewers.add(viewer);
        text(viewer, { type: 'seats', seats: seats() });
        return {
          message: (opcode, payload) => {
            if (opcode === OPCODE.text && payload.length <= 2048) control(viewer, payload);
            else if (opcode === OPCODE.binary) frame(viewer, payload);
          },
          closed: () => { viewers.delete(viewer); stand(viewer); },
        };
      },
    });
  }
  function close() { for (const viewer of [...viewers]) viewer.peer.close(); }
  return { upgrade, close };
}
