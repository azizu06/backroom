/**
 * Proximity text chat between office viewers in Play. View-only: messages are plain text between
 * browsers and never reach a model, a tool or policy. A message reaches only viewers within
 * PROXIMITY_RADIUS of where the sender stood when sending, measured where the receiver stands on arrival.
 */
import { FLOOR } from './play';

export const PROXIMITY_RADIUS = 6;
export const CHAT_MAX_LENGTH = 280;
export const CHAT_TTL = 60_000;
export const CHAT_BUBBLE_MS = 5_000;
export const CHAT_RATE = { perSecond: 1, perMinute: 10 } as const;
/** Clock skew allowed for a sender's `at` in the future. */
export const CHAT_SKEW = 5_000;
export const CHAT_LOG_LIMIT = 50;

export interface ChatMessage { id: string; viewerId: string; name: string; color: string; text: string; x: number; z: number; at: number }
/** A delivered message; `receivedAt` is the local clock, so bubbles and TTL ignore sender clock skew. */
export interface ChatEntry extends ChatMessage { receivedAt: number }
export interface ChatBubble { viewerId: string; id: string; text: string }
export interface ChatPose { x: number; z: number }
export interface ChatTransport { send(message: ChatMessage): void; subscribe(onMessage: (message: unknown) => void): () => void; close(): void }

// C0/C1 controls, DEL and bidi overrides/isolates (they can visually reorder a neighbour's text).
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
export function sanitizeChatText(text: unknown, max = CHAT_MAX_LENGTH): string {
  if (typeof text !== 'string') return '';
  return Array.from(text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim();
}

/** Validated copy of an untrusted message, or null. Coordinates must be finite and are clamped to the floor. */
export function sanitizeChatMessage(raw: unknown, now: number, ttl = CHAT_TTL): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<Record<keyof ChatMessage, unknown>>;
  if (typeof m.id !== 'string' || !/^[\w-]{1,64}$/.test(m.id) || typeof m.viewerId !== 'string' || !m.viewerId || m.viewerId.length > 64) return null;
  if (typeof m.x !== 'number' || typeof m.z !== 'number' || typeof m.at !== 'number' || ![m.x, m.z, m.at].every(Number.isFinite)) return null;
  if (now - m.at > ttl || m.at > now + CHAT_SKEW) return null;
  const text = sanitizeChatText(m.text);
  if (!text) return null;
  const name = sanitizeChatText(m.name, 24) || 'Viewer';
  const color = typeof m.color === 'string' && /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#a9bc8f';
  return { id: m.id, viewerId: m.viewerId, name, color, text, at: m.at,
    x: Math.max(FLOOR.minX, Math.min(FLOOR.maxX, m.x)), z: Math.max(FLOOR.minZ, Math.min(FLOOR.maxZ, m.z)) };
}

export function withinProximity(sender: ChatPose, receiver: ChatPose, radius = PROXIMITY_RADIUS): boolean {
  return [sender.x, sender.z, receiver.x, receiver.z].every(Number.isFinite) && Math.hypot(sender.x - receiver.x, sender.z - receiver.z) <= radius;
}

/** Sliding-window limit: at most `perSecond` in any 1 s and `perMinute` in any 60 s. Returns the trimmed history. */
export function rateLimit(history: readonly number[], now: number, limits: { perSecond: number; perMinute: number } = CHAT_RATE): { allowed: boolean; history: number[] } {
  const recent = history.filter(at => now - at < 60_000 && at <= now);
  const allowed = recent.filter(at => now - at < 1_000).length < limits.perSecond && recent.length < limits.perMinute;
  return { allowed, history: allowed ? [...recent, now] : recent };
}

export function pruneChat(log: readonly ChatEntry[], now: number, ttl = CHAT_TTL): ChatEntry[] {
  return log.filter(entry => now - entry.receivedAt < ttl);
}

/**
 * Delivery decision for one incoming message. Returns the next log (same array when dropped): drops
 * malformed, expired, duplicate (by id), own-echo, out-of-range and rate-limited messages.
 */
export function receiveChat(log: readonly ChatEntry[], raw: unknown, { selfId, receiver, now, histories }: {
  selfId: string; receiver: ChatPose | null; now: number; histories: Map<string, number[]>;
}): readonly ChatEntry[] {
  const message = sanitizeChatMessage(raw, now);
  if (!message || message.viewerId === selfId || !receiver || !withinProximity(message, receiver)) return log;
  if (log.some(entry => entry.id === message.id)) return log;
  const limited = rateLimit(histories.get(message.viewerId) ?? [], now);
  histories.set(message.viewerId, limited.history);
  if (!limited.allowed) return log;
  return [...pruneChat(log, now), { ...message, receivedAt: now }].slice(-CHAT_LOG_LIMIT);
}

/** Latest message per other viewer that is still inside the bubble window. */
export function chatBubbles(log: readonly ChatEntry[], selfId: string, now: number, ms = CHAT_BUBBLE_MS): ChatBubble[] {
  const latest = new Map<string, ChatBubble>();
  for (const entry of log) if (entry.viewerId !== selfId && now - entry.receivedAt < ms) latest.set(entry.viewerId, { viewerId: entry.viewerId, id: entry.id, text: entry.text });
  return [...latest.values()];
}
/** When the log next changes on its own (a bubble ends or an entry expires), or null. */
export function nextChatChange(log: readonly ChatEntry[], now: number): number | null {
  let next: number | null = null;
  for (const entry of log) for (const at of [entry.receivedAt + CHAT_BUBBLE_MS, entry.receivedAt + CHAT_TTL]) if (at > now && (next === null || at < next)) next = at;
  return next;
}

type ChannelLike = { postMessage(value: unknown): void; addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void; removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void; close(): void };
/** Same-browser transport (tabs of one origin). BroadcastChannel never echoes to the sender. */
export function createBroadcastChat(channelName = 'backroom-office-chat', channel?: ChannelLike): ChatTransport {
  const target = channel ?? (typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : undefined);
  const listeners = new Set<(message: unknown) => void>();
  const onMessage = (event: { data: unknown }) => listeners.forEach(listener => listener(event.data));
  target?.addEventListener('message', onMessage);
  return {
    send(message) { target?.postMessage(message); },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close() { listeners.clear(); target?.removeEventListener('message', onMessage); target?.close(); },
  };
}

/**
 * Picks the chat transport. Only BroadcastChannel exists today.
 * TODO(spacetime office_chat): once the stream-C owner OKs it, add a public `office_chat` table
 * (id, viewer_id, name, text, x, z, at; no identity or colour, short server-side TTL and rate limit)
 * with an `office_chat_send` reducer, and return a `createSpacetimeChat(connection, viewerId)` transport
 * here when `presenceTransportKind(...) === 'spacetime'`. Receivers still apply receiveChat (range,
 * sanitising, rate limit, de-dup, TTL) locally. Do not edit spacetime/ from this stream.
 */
export function createChatTransport(): ChatTransport {
  return createBroadcastChat();
}

/** Lets a Play panel (e.g. "Say hi") prefill the HUD chat box without importing it. */
const draftListeners = new Set<(text: string) => void>();
export function requestChatDraft(text: string) { draftListeners.forEach(listener => listener(sanitizeChatText(text))); }
export function onChatDraft(listener: (text: string) => void): () => void { draftListeners.add(listener); return () => { draftListeners.delete(listener); }; }
