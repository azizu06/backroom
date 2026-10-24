import { afterEach, describe, expect, it, vi } from 'vitest';
import { callFromProjection, callReducer, callStore, IDLE_CALL, isMockCalls, requestCall, type CallEvent } from './calls';
import { createMockCallFeed } from './calls-mock';

describe('call state', () => {
  it('accepts valid transitions and preserves identity on invalid transitions', () => {
    const ring: CallEvent = { type: 'ring', callId: 'a', direction: 'inbound' };
    const ringing = callReducer(IDLE_CALL, ring);
    expect(ringing.status).toBe('ringing');
    expect(callReducer(ringing, { type: 'line', callId: 'a', line: { id: 'early', speaker: 'caller', text: 'x', at: 1 } })).toBe(ringing);
    expect(callReducer(ringing, { type: 'ring', callId: 'b', direction: 'inbound' })).toBe(ringing);
    expect(callReducer(ringing, { type: 'answer', callId: 'other' })).toBe(ringing);
    const live = callReducer(ringing, { type: 'answer', callId: 'a' });
    expect(live.status).toBe('live');
    const ended = callReducer(live, { type: 'end', callId: 'a', reason: 'done' });
    expect(ended.status).toBe('ended');
    expect(callReducer(ended, { type: 'end', callId: 'a' })).toBe(ended);
    expect(callReducer(ended, { type: 'clear' })).toBe(IDLE_CALL);
    expect(callReducer(IDLE_CALL, { type: 'clear' })).toBe(IDLE_CALL);
  });
  it('dedupes transcript lines and retains only the newest 50', () => {
    let state = callReducer(IDLE_CALL, { type: 'ring', callId: 'a', direction: 'inbound' });
    state = callReducer(state, { type: 'answer', callId: 'a' });
    for (let i = 0; i < 55; i++) state = callReducer(state, { type: 'line', callId: 'a', line: { id: String(i), speaker: 'agent', agentId: 'collections', text: String(i), at: i } });
    const same = callReducer(state, { type: 'line', callId: 'a', line: { id: '54', speaker: 'agent', text: 'duplicate', at: 60 } });
    expect(same).toBe(state); expect(state.transcript).toHaveLength(50); expect(state.transcript[0]?.id).toBe('5'); expect(state.speakingAgentId).toBe('collections');
    expect(callReducer(state, { type: 'line', callId: 'wrong', line: { id: 'z', speaker: 'caller', text: 'x', at: 0 } })).toBe(state);
  });
  it('maps defensive projection rows and rejects junk', () => {
    expect(callFromProjection(null)).toBeNull();
    expect(callFromProjection({ id: 'c', status: 'live', direction: 'inbound', transcript: [{ id: 'l', speaker: 'agent', text: 'hello' }, {}] })).toMatchObject({ callId: 'c', status: 'live', transcript: [{ id: 'l', text: 'hello' }] });
    expect(callFromProjection({ id: {}, status: 'nope' })).toBeNull();
  });
  it('does not fetch while the request endpoint is unset', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(requestCall()).resolves.toEqual({ ok: false, reason: 'unavailable', message: 'Call requests not available yet' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('runs mock calls in ringing, live, ended, idle order', () => {
    vi.useFakeTimers();
    const events: CallEvent[] = [];
    const stop = createMockCallFeed(event => events.push(event), 10);
    expect(events[0]?.type).toBe('ring');
    vi.advanceTimersByTime(20_000);
    const states = events.map(event => event.type);
    expect(states).toContain('answer'); expect(states).toContain('line'); expect(states).toContain('end'); expect(states).toContain('clear');
    expect(states.indexOf('ring')).toBeLessThan(states.indexOf('answer'));
    expect(states.indexOf('answer')).toBeLessThan(states.indexOf('line'));
    expect(states.indexOf('line')).toBeLessThan(states.indexOf('end'));
    expect(states.indexOf('end')).toBeLessThan(states.indexOf('clear'));
    stop();
  });
  it('publishes mock transcript lines through the subscribed call store', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { location: { search: '?calls=mock&callsSpeed=fast' } });
    const updates = vi.fn();
    const unsubscribe = callStore.subscribe(updates);
    vi.advanceTimersByTime(2_000);
    expect(callStore.getSnapshot().status).toBe('live');
    expect(callStore.getSnapshot().transcript.length).toBeGreaterThan(0);
    expect(callStore.getSnapshot().transcript[0]?.text).toContain('Thanks for calling back');
    unsubscribe();
  });
  it('recognizes only the explicit mock flag', () => { expect(isMockCalls('?calls=mock')).toBe(true); expect(isMockCalls('?calls=live')).toBe(false); });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
