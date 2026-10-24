import { afterEach, describe, expect, it } from 'vitest';
import { createGateway } from '../gateway/http';
import { installGatewayStore } from '../gateway/runtime';
import { MemoryGatewayStore, type GatewayCall } from '../gateway/store';
import { recordVoiceCallEvent, voiceCallLifecycle } from './lifecycle';
import { activeCall } from './runtime';

const SESSION = '00000000-0000-4000-8000-0000000000aa';
const call = (callId: string, agentId: string): GatewayCall => ({ callId, agentId, invoiceId: '1042', clientId: 'northfield-jordan', contactName: 'Jordan',
  companyName: 'Northfield Studio', amountCents: 495000, receivable: { principalCents: 480000, lateFeeCents: 15000 }, currency: 'USD', policyVersion: 1,
  identityConfirmed: false, status: 'active', audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {} });
afterEach(() => installGatewayStore(new MemoryGatewayStore()));

describe('desk phone feed', () => {
  it('shows only the latest voice call, through ringing, live and a short ended window', async () => {
    expect(await activeCall()).toBeNull();
    const store = new MemoryGatewayStore([call('demo-collections-1042', 'demo:collections')]);
    installGatewayStore(store);
    expect(await activeCall()).toBeNull();
    await store.registerCall(call(SESSION, 'voice:collections'));
    recordVoiceCallEvent(SESSION, 'registered', 1000);
    expect(await activeCall(2000)).toMatchObject({ status: 'ringing', direction: 'outbound' });
    recordVoiceCallEvent(SESSION, 'started', 3000);
    recordVoiceCallEvent(SESSION, 'started', 9000);
    expect(voiceCallLifecycle(SESSION)).toEqual({ registeredAt: 1000, startedAt: 3000 });
    expect(await activeCall(4000)).toMatchObject({ status: 'live', startedAt: 3000 });
    recordVoiceCallEvent(SESSION, 'completed', 5000);
    expect(await activeCall(6000)).toMatchObject({ status: 'ended', endReason: 'Call ended' });
    expect(await activeCall(5000 + 2 * 60_000 + 1)).toBeNull();
    expect(() => recordVoiceCallEvent('not-a-session', 'started')).toThrow('INVALID_SESSION');
  });
  it('hides a gateway-stopped call two minutes after the stop even if the provider end event never arrives', async () => {
    const STOPPED = '00000000-0000-4000-8000-0000000000bb';
    const store = new MemoryGatewayStore([]);
    installGatewayStore(store);
    await store.registerCall(call(STOPPED, 'voice:collections'));
    recordVoiceCallEvent(STOPPED, 'registered', Date.now());
    recordVoiceCallEvent(STOPPED, 'started', Date.now());
    const gateway = createGateway({ secret: () => 'gateway', store });
    await gateway('record_opt_out', new Request('https://gateway.test/api/tools/record_opt_out', { method: 'POST',
      headers: { authorization: 'Bearer gateway', 'content-type': 'application/json' }, body: JSON.stringify({ call_id: STOPPED, webhook_request_id: 'stop-1' }) }));
    const stopped = (await activeCall())!;
    expect(stopped).toMatchObject({ status: 'ended', endReason: 'Opt-out recorded', endedAt: expect.any(Number) });
    expect(await activeCall(stopped.endedAt! + 2 * 60_000 + 1)).toBeNull();
  });
});
