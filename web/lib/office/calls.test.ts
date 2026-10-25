import { afterEach, describe, expect, it, vi } from 'vitest';
import { callFromProjection, callReducer, callStore, IDLE_CALL, isMockCalls, pollCallFeed, requestCall, type CallEvent } from './calls';
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
  it('posts only the line to the host request endpoint and flags a locked operator session', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ ok: true, message: 'Ringing' }))
      .mockResolvedValueOnce(Response.json({ ok: false, message: 'Calls are locked.' }, { status: 401 }));
    await expect(requestCall()).resolves.toEqual({ ok: true, message: 'Ringing' });
    expect(fetch).toHaveBeenCalledWith('/api/calls/request', expect.objectContaining({ method: 'POST', body: '{"line":"collections"}' }));
    await expect(requestCall()).resolves.toEqual({ ok: false, reason: 'locked', message: 'Calls are locked.' });
    vi.stubGlobal('window', { location: { search: '?calls=mock' } });
    await expect(requestCall()).resolves.toEqual({ ok: false, reason: 'unavailable', message: 'Mock preview: no call placed' });
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
  it('maps the polled host projection into phone state and keeps it through a failed poll', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ call: { callId: 'call-1', status: 'live', direction: 'outbound',
      transcript: [{ id: 'a1', speaker: 'agent', agentId: 'collections', text: 'propose_plan → DENY FEES_NON_WAIVABLE', at: 1 }] } }))
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json({ call: null }));
    const states: string[] = [];
    const stop = pollCallFeed(state => states.push(state.status), 1000);
    await vi.advanceTimersByTimeAsync(3500);
    stop();
    expect(states).toEqual(['live', 'idle']);
  });
  it('backs off after a 503 and drops a ringing call to idle after repeated failures', async () => {
    vi.useFakeTimers();
    const unavailable = () => new Response(JSON.stringify({ error: 'CALL_FEED_UNAVAILABLE' }), { status: 503 });
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ call: { callId: 'call-1', status: 'ringing', direction: 'outbound', transcript: [] } }))
      .mockImplementation(async () => unavailable());
    const states: string[] = [];
    const stop = pollCallFeed(state => states.push(state.status), 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual(['ringing']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(states).toEqual(['ringing']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(3999);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(states).toEqual(['ringing', 'idle']);
    expect(fetch).toHaveBeenCalledTimes(4);
    const settled = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(7999);
    expect(fetch.mock.calls.length).toBe(settled);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch.mock.calls.length).toBe(settled + 1);
    stop();
  });
  it('pauses while the tab is hidden and polls again when it becomes visible', async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ call: null }));
    let visibilityState = 'visible';
    const listeners = new Set<() => void>();
    vi.stubGlobal('document', {
      get visibilityState() { return visibilityState; },
      addEventListener(_type: string, listener: () => void) { listeners.add(listener); },
      removeEventListener(_type: string, listener: () => void) { listeners.delete(listener); },
    });
    const stop = pollCallFeed(() => {}, 1000);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    visibilityState = 'hidden';
    listeners.forEach(listener => listener());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    visibilityState = 'visible';
    listeners.forEach(listener => listener());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    stop();
    expect(listeners.size).toBe(0);
    vi.unstubAllGlobals();
  });
  it('stops polling when the last subscriber unsubscribes', async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ call: null }));
    vi.stubGlobal('window', { location: { search: '' } });
    const unsubscribe = callStore.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch.mock.calls.length).toBeGreaterThan(0);
    const settled = fetch.mock.calls.length;
    unsubscribe();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch.mock.calls.length).toBe(settled);
    expect(callStore.getSnapshot()).toEqual(IDLE_CALL);
    vi.unstubAllGlobals();
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
    vi.advanceTimersByTime(500);
    expect(callStore.getSnapshot().status).toBe('live');
    expect(callStore.getSnapshot().transcript.length).toBeGreaterThan(0);
    expect(callStore.getSnapshot().transcript[0]?.text).toContain('Thanks for calling back');
    unsubscribe();
  });
  it('recognizes only the explicit mock flag', () => { expect(isMockCalls('?calls=mock')).toBe(true); expect(isMockCalls('?calls=live')).toBe(false); });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
