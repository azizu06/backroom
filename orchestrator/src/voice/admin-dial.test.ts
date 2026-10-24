import { describe, expect, it, vi } from 'vitest';
import { computeEnvelope, DEFAULT_POLICY } from '@backroom/policy';
import { createAdminDial } from './admin-dial';
import { createDemoVoiceBridge } from './demo-bridge';
import { dialCollectionCall, type DialInput } from './index';

// Synthetic test numbers only; the relay reads the real destination from server env.
const TARGET = '+15555550100';
function harness(preCall: unknown, options: { status?: number; provider?: () => Promise<Response> } = {}) {
  const host: { path: string; body?: Record<string, unknown> }[] = [];
  const network = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    host.push({ path, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (path === '/__demo/status') return options.status ? new Response('', { status: options.status }) : Response.json({ services: { preCall } });
    if (path === '/__demo/voice-client-stopped') return Response.json({ stopped: false });
    return Response.json({ ok: true });
  });
  const bridge = createDemoVoiceBridge({ port: 3000, controlSecret: 'control', publicOrigin: 'https://demo.example', fetch: network });
  let dials = 0;
  const provider = vi.fn(options.provider ?? (async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ calls: [{ agent_call_id: `ac-${++dials}` }] })));
  const audits: { action: string; ruleIds: string[]; reason?: string }[] = [];
  const dialed: DialInput[] = [];
  const stopped = new Map<string, boolean>();
  let next = 0;
  const dial = createAdminDial({ bridge, audit: async entry => { audits.push(entry); },
    newSessionId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
    sessionStopped: async id => stopped.get(id) ?? true,
    dial: async (sessionId, signals, providerRequest) => {
      const input: DialInput = { sessionId, agentId: 'agent-1', fromNumberId: 'number-1', clientId: 'northfield-jordan', invoiceId: '1042',
        businessName: 'Northfield Studio', contactName: 'Jordan', callbackNumber: '+15555550101', signals,
        client: { type: 'business', number: TARGET, timeZone: 'America/Los_Angeles', dnc: false,
          consent: { number: TARGET, source: 'test', text: 'consent', timestamp: '2026-10-01T00:00:00Z' } } };
      dialed.push(input);
      return dialCollectionCall(input, { apiKey: 'key', now: new Date('2026-10-26T18:00:00Z'),
        http: (url, init) => { providerRequest(); return provider(url, init); },
        audit: async entry => { audits.push(entry); },
        prepare: async session => { await bridge.register(session.id); stopped.set(session.id, false); } });
    } });
  return { dial, provider, audits, host, dialed, stopped };
}

describe('/_admin/dial pre-call gate', () => {
  it('refuses a blocked pre-call with no provider request and audits the reason', async () => {
    const h = harness({ status: 'blocked', reason: 'Credit/OFAC check unavailable' });
    expect(await h.dial()).toEqual({ status: 409, body: 'PRECALL_BLOCKED:Credit/OFAC check unavailable' });
    expect(h.provider).not.toHaveBeenCalled();
    expect(h.host.map(r => r.path)).not.toContain('/__demo/voice-call');
    expect(h.audits).toEqual([expect.objectContaining({ action: 'CALL_BLOCKED_PRECALL', reason: 'Credit/OFAC check unavailable' })]);
  });
  it('never treats a missing, unprepared, paused, malformed or unreachable pre-call as clear', async () => {
    for (const [preCall, status, body] of [
      [{ status: 'not_prepared' }, 409, 'PRECALL_NOT_READY:not_prepared'], [{ status: 'paused', reason: 'LLM_OFF' }, 409, 'PRECALL_NOT_READY:paused'],
      [undefined, 503, 'PRECALL_UNAVAILABLE'], [{ status: 'ready', signals: { bankruptcy: 'no' } }, 503, 'PRECALL_UNAVAILABLE'],
    ] as const) {
      const h = harness(preCall);
      expect(await h.dial()).toEqual({ status, body });
      expect(h.provider).not.toHaveBeenCalled();
      expect(h.audits.map(a => a.action)).toEqual(['CALL_BLOCKED_PRECALL']);
    }
    const down = harness({ status: 'ready' }, { status: 503 });
    expect(await down.dial()).toEqual({ status: 503, body: 'PRECALL_UNAVAILABLE' });
    expect(down.provider).not.toHaveBeenCalled();
    expect(down.audits).toEqual([expect.objectContaining({ action: 'CALL_BLOCKED_PRECALL', reason: 'pre-call status unreachable' })]);
  });
  it('dials a ready pre-call unchanged and narrows the envelope with its signals', async () => {
    const h = harness({ status: 'ready', signals: { active: ['health_check_pending'] } });
    const result = await h.dial();
    expect(result).toEqual({ status: 200, body: { sessionId: expect.any(String), callId: 'ac-1' } });
    expect(h.provider).toHaveBeenCalledTimes(1);
    expect(h.audits.map(a => a.action)).toEqual(['CALL_PERMIT']);
    const request = JSON.parse(String(h.provider.mock.calls[0]![1]?.body));
    expect(request.outbound_calls).toEqual([{ to_number: TARGET, dynamic_variables: expect.objectContaining({
      envelope_summary: JSON.stringify(computeEnvelope(DEFAULT_POLICY, ['health_check_pending'])) }) }]);
    expect(h.dialed[0]!.signals).toEqual({ active: ['health_check_pending'] });
  });
  it('re-checks typed stop signals at the dial boundary before any provider request', async () => {
    const h = harness({ status: 'ready', signals: { bankruptcy: true, active: [] } });
    expect(await h.dial()).toEqual({ status: 409, body: 'CALL_DENIED:BANKRUPTCY_STOP' });
    expect(h.provider).not.toHaveBeenCalled();
    expect(h.host.at(-1)).toMatchObject({ path: '/__demo/voice-call-event', body: { event: 'failed' } });
  });
  it('holds the line while a call is active and refuses a concurrent dial', async () => {
    const h = harness({ status: 'ready' });
    const [first, second] = await Promise.all([h.dial(), h.dial()]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect([first.body, second.body]).toContain('DIAL_IN_PROGRESS');
    expect(await h.dial()).toEqual({ status: 409, body: 'CALL_ACTIVE' });
    expect(h.provider).toHaveBeenCalledTimes(1);
    for (const id of h.stopped.keys()) h.stopped.set(id, true);
    expect((await h.dial()).status).toBe(200);
    expect(h.provider).toHaveBeenCalledTimes(2);
  });
  it('never redials an unconfirmed provider request but releases a definite rejection', async () => {
    const timeout = harness({ status: 'ready' }, { provider: async () => { throw new DOMException('timed out', 'TimeoutError'); } });
    expect(await timeout.dial()).toEqual({ status: 504, body: 'DIAL_UNCONFIRMED' });
    expect(await timeout.dial()).toEqual({ status: 409, body: 'CALL_ACTIVE' });
    expect(timeout.provider).toHaveBeenCalledTimes(1);
    const rejected = harness({ status: 'ready' }, { provider: async () => new Response('{}', { status: 400 }) });
    expect(await rejected.dial()).toEqual({ status: 502, body: 'DIAL_FAILED' });
    expect(rejected.host.at(-1)).toMatchObject({ path: '/__demo/voice-call-event', body: { event: 'failed' } });
    expect((await rejected.dial()).status).toBe(502);
  });
});
