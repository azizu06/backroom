import { describe, expect, it } from 'vitest';
import {
  CHAT_BUBBLE_MS, CHAT_MAX_LENGTH, CHAT_TTL, PROXIMITY_RADIUS, chatBubbles, createBroadcastChat, nextChatChange, onChatDraft, pruneChat,
  rateLimit, receiveChat, requestChatDraft, sanitizeChatMessage, sanitizeChatText, withinProximity, type ChatEntry, type ChatMessage,
} from './proximity-chat';

const NOW = 100_000;
function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'm1', viewerId: 'peer', name: 'Viewer AB12', color: '#a9bc8f', text: 'hello', x: -5, z: 0.9, at: NOW, ...overrides };
}
function receive(log: readonly ChatEntry[], raw: unknown, receiver = { x: -5, z: 0.9 }, now = NOW, histories = new Map<string, number[]>()) {
  return receiveChat(log, raw, { selfId: 'me', receiver, now, histories });
}

describe('proximity chat helpers', () => {
  it('strips control and bidi characters, collapses whitespace and caps the length', () => {
    expect(sanitizeChatText('  hi\u0000\nthere\u0007\u202e!\u007f ')).toBe('hi there !');
    expect(sanitizeChatText('<b>bold</b>')).toBe('<b>bold</b>');
    expect(sanitizeChatText('x'.repeat(400))).toHaveLength(CHAT_MAX_LENGTH);
    expect(sanitizeChatText('😀'.repeat(300))).toBe('😀'.repeat(CHAT_MAX_LENGTH));
    expect(sanitizeChatText(42)).toBe('');
    expect(sanitizeChatText('\u0000\n\t')).toBe('');
  });
  it('validates messages and drops non-finite coordinates, bad ids and expired or future timestamps', () => {
    expect(sanitizeChatMessage(message(), NOW)).toEqual(message());
    expect(sanitizeChatMessage(message({ x: Number.NaN }), NOW)).toBeNull();
    expect(sanitizeChatMessage(message({ z: Number.POSITIVE_INFINITY }), NOW)).toBeNull();
    expect(sanitizeChatMessage({ ...message(), x: '1' }, NOW)).toBeNull();
    expect(sanitizeChatMessage(message({ id: 'has space' }), NOW)).toBeNull();
    expect(sanitizeChatMessage(message({ text: '\n\u0001' }), NOW)).toBeNull();
    expect(sanitizeChatMessage(message({ at: NOW - CHAT_TTL - 1 }), NOW)).toBeNull();
    expect(sanitizeChatMessage(message({ at: NOW + 10_000 }), NOW)).toBeNull();
    expect(sanitizeChatMessage(null, NOW)).toBeNull();
    expect(sanitizeChatMessage(message({ x: 99, color: 'red', name: 'N\u0000ame' }), NOW)).toMatchObject({ x: 8, color: '#a9bc8f', name: 'N ame' });
  });
  it('filters by distance, inclusive at the radius', () => {
    expect(withinProximity({ x: 0, z: 0 }, { x: PROXIMITY_RADIUS, z: 0 })).toBe(true);
    expect(withinProximity({ x: 0, z: 0 }, { x: 4.3, z: 4.3 })).toBe(false);
    expect(withinProximity({ x: 0, z: Number.NaN }, { x: 0, z: 0 })).toBe(false);
  });
  it('rate limits to 1 message per second and 10 per minute', () => {
    let history: number[] = [];
    const allowed: boolean[] = [];
    for (const at of [0, 500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10_000, 60_000]) {
      const result = rateLimit(history, at);
      history = result.history;
      allowed.push(result.allowed);
    }
    // 500 ms is too soon; the 11th accepted send inside a minute (10 000) is refused; at 60 s the window has slid.
    expect(allowed).toEqual([true, false, true, true, true, true, true, true, true, true, true, false, true]);
  });
  it('delivers in range, drops out of range, de-duplicates by id and ignores its own echo', () => {
    const delivered = receive([], message());
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ id: 'm1', receivedAt: NOW });
    expect(receive(delivered, message())).toBe(delivered);
    expect(receive([], message(), { x: 5, z: 0.6 })).toEqual([]);
    expect(receive([], message(), null as never)).toEqual([]);
    expect(receive([], message({ viewerId: 'me' }))).toEqual([]);
  });
  it('rate limits each sender on receipt', () => {
    const histories = new Map<string, number[]>();
    let log = receive([], message({ id: 'a' }), undefined, NOW, histories);
    log = receive(log, message({ id: 'b' }), undefined, NOW + 100, histories);
    log = receive(log, message({ id: 'c', viewerId: 'other' }), undefined, NOW + 100, histories);
    expect(log.map(entry => entry.id)).toEqual(['a', 'c']);
  });
  it('expires entries after the TTL and shows bubbles for 5 s', () => {
    const log = receive([], message());
    expect(chatBubbles(log, 'me', NOW + CHAT_BUBBLE_MS - 1)).toEqual([{ viewerId: 'peer', id: 'm1', text: 'hello' }]);
    expect(chatBubbles(log, 'me', NOW + CHAT_BUBBLE_MS)).toEqual([]);
    expect(chatBubbles(log, 'peer', NOW)).toEqual([]);
    expect(nextChatChange(log, NOW)).toBe(NOW + CHAT_BUBBLE_MS);
    expect(nextChatChange(log, NOW + CHAT_BUBBLE_MS)).toBe(NOW + CHAT_TTL);
    expect(pruneChat(log, NOW + CHAT_TTL - 1)).toHaveLength(1);
    expect(pruneChat(log, NOW + CHAT_TTL)).toEqual([]);
    expect(nextChatChange([], NOW)).toBeNull();
  });
  it('keeps only the latest bubble per sender', () => {
    let log = receive([], message({ id: 'a', text: 'one' }));
    log = receive(log, message({ id: 'b', text: 'two', at: NOW + 1500 }), undefined, NOW + 1500);
    expect(chatBubbles(log, 'me', NOW + 1500)).toEqual([{ viewerId: 'peer', id: 'b', text: 'two' }]);
  });
  it('uses a broadcast transport with an injected channel', () => {
    const handlers: ((event: { data: unknown }) => void)[] = [];
    const sent: unknown[] = [];
    let closed = false;
    const channel = { postMessage: (value: unknown) => sent.push(value), addEventListener: (_: 'message', fn: (event: { data: unknown }) => void) => handlers.push(fn), removeEventListener: () => {}, close: () => { closed = true; } };
    const transport = createBroadcastChat('test', channel);
    const received: unknown[] = [];
    const unsubscribe = transport.subscribe(value => received.push(value));
    transport.send(message());
    handlers[0]!({ data: message({ id: 'm2' }) });
    unsubscribe();
    handlers[0]!({ data: message({ id: 'm3' }) });
    transport.close();
    expect(sent).toEqual([message()]);
    expect(received).toEqual([message({ id: 'm2' })]);
    expect(closed).toBe(true);
  });
  it('passes sanitised drafts from panels to the chat box', () => {
    const drafts: string[] = [];
    const off = onChatDraft(text => drafts.push(text));
    requestChatDraft('Hi\nthere');
    off();
    requestChatDraft('ignored');
    expect(drafts).toEqual(['Hi there']);
  });
});
