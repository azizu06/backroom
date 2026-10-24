import { FLOOR } from './play';

export interface PresencePeer { viewerId: string; name: string; color: string; x: number; z: number; yaw: number; mode: 'overview' | 'play' | 'tour'; at: number }
export interface PresenceTransport { publish(self: PresencePeer): void; subscribe(onPeers: (peers: PresencePeer[]) => void): () => void; close(): void }
export const PRESENCE_TTL = 10_000;
export const PRESENCE_HEARTBEAT = 3_000;
export const PRESENCE_RATE = 250;
export type PresenceClock = () => number;

export function presencePeers(messages: readonly unknown[], selfId: string, now: number, ttl = PRESENCE_TTL): PresencePeer[] {
  const peers = new Map<string, PresencePeer>();
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const p = message as Partial<PresencePeer>;
    if (typeof p.viewerId !== 'string' || !p.viewerId || p.viewerId === selfId || typeof p.name !== 'string' || typeof p.color !== 'string'
      || ![p.x, p.z, p.yaw, p.at].every(Number.isFinite) || !['overview', 'play', 'tour'].includes(p.mode as string)) continue;
    if (now - p.at! > ttl || p.at! > now + 1000) continue;
    const peer: PresencePeer = { viewerId: p.viewerId, name: p.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 24), color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#a9bc8f',
      x: Math.max(FLOOR.minX, Math.min(FLOOR.maxX, p.x!)), z: Math.max(FLOOR.minZ, Math.min(FLOOR.maxZ, p.z!)), yaw: p.yaw!, mode: p.mode as PresencePeer['mode'], at: p.at! };
    const old = peers.get(peer.viewerId);
    if (!old || peer.at > old.at) peers.set(peer.viewerId, peer);
  }
  return [...peers.values()].sort((a, b) => b.at - a.at).slice(0, 12);
}

export function ghostPeers(peers: readonly PresencePeer[]): PresencePeer[] { return peers.filter(peer => peer.mode === 'play'); }

export function viewerName(id: string) { return `Viewer ${id.replace(/[^a-f0-9]/gi, '').slice(-4).toUpperCase().padStart(4, '0')}`; }
export function viewerColor(id: string) {
  let hash = 2166136261;
  for (const c of id) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const colors = ['#a9bc8f', '#d8a879', '#89b7b2', '#c49ab8', '#d3c36f', '#8fa9d0'];
  return colors[(hash >>> 0) % colors.length]!;
}
export function getViewerId(storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof sessionStorage === 'undefined' ? undefined : sessionStorage) {
  try { const existing = storage?.getItem('backroom-viewer-id'); if (existing) return existing; } catch { /* storage can be disabled */ }
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(16).slice(2, 14);
  try { storage?.setItem('backroom-viewer-id', id); } catch { /* storage can be disabled */ }
  return id;
}

type ChannelLike = { postMessage(value: unknown): void; addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void; removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void; close(): void };
export function createBroadcastPresence(channelName: string, channel?: ChannelLike, clock: PresenceClock = Date.now): PresenceTransport {
  const target = channel ?? (typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : undefined);
  const messages = new Map<string, unknown>();
  let selfId = '';
  let listener: ((peers: PresencePeer[]) => void) | undefined;
  const read = () => {
    const now = clock();
    for (const [id, message] of messages) {
      const at = (message as Partial<PresencePeer> | null)?.at;
      if (!Number.isFinite(at) || now - Number(at) > PRESENCE_TTL || Number(at) > now + 1000) messages.delete(id);
    }
    return presencePeers([...messages.values()], selfId, now);
  };
  const onMessage = (event: { data: unknown }) => {
    const p = event.data as Partial<PresencePeer> | null;
    if (p && typeof p.viewerId === 'string' && p.viewerId) {
      const old = messages.get(p.viewerId) as Partial<PresencePeer> | undefined;
      if (!old || !Number.isFinite(old.at) || Number(p.at) >= Number(old.at)) messages.set(p.viewerId, event.data);
      while (messages.size > 32) {
        const oldest = [...messages].sort((a, b) => Number((a[1] as Partial<PresencePeer>).at) - Number((b[1] as Partial<PresencePeer>).at))[0];
        if (oldest) messages.delete(oldest[0]); else break;
      }
    }
    if (listener) listener(read());
  };
  target?.addEventListener('message', onMessage);
  return { publish(self) { selfId = self.viewerId; target?.postMessage(self); }, subscribe(onPeers) { listener = onPeers; onPeers(read()); return () => { listener = undefined; }; }, close() { target?.removeEventListener('message', onMessage); target?.close(); } };
}
export function createNoopPresence(): PresenceTransport { return { publish() {}, subscribe(callback) { callback([]); return () => {}; }, close() {} }; }
// TODO(spacetime office_presence): replace this factory slot with a SpacetimeDB transport when the table lands.
export const createSpacetimePresence = createNoopPresence;
