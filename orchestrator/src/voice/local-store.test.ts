import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { LocalGatewayStore } from './local-store';
import { createVoiceHandler, VoiceJournal } from './server';
import type { GatewayCall } from '../../../web/lib/gateway/store';

it('keeps client stops and lifecycle deduplication after restarting the local adapters', async () => {
  const dir = mkdtempSync(resolve(process.cwd(), '.env.voice-test-'));
  try {
    let store = new LocalGatewayStore(`${dir}/gateway.json`);
    const call: GatewayCall = { callId: 'session', clientId: 'client', invoiceId: '1042', contactName: 'Jordan', companyName: 'Northfield',
      amountCents: 495000, receivable: { principalCents: 480000, lateFeeCents: 15000 }, currency: 'USD', policyVersion: 1, identityConfirmed: false,
      status: 'active', audits: [], plans: [], links: [], escalations: [], outbox: [], deliveries: {} };
    await store.add(call);
    await store.transact('session', call => { call.status = 'opted_out'; });
    store = new LocalGatewayStore(`${dir}/gateway.json`);
    expect(await store.clientStopped('client')).toBe(true);
    await expect(store.transact('session', call => { call.status = 'active'; throw Error('rollback'); })).rejects.toThrow('rollback');
    expect(await store.clientStopped('client')).toBe(true);
    let journal = new VoiceJournal(`${dir}/journal.json`);
    await journal.register({ id: 'session', contactName: 'Jordan', welcome: 'disclosure', nonce: 'nonce', providerCallId: 'ac', disclosureComplete: false, stopped: false, deliveries: {} });
    const event = () => new Request('https://relay.test/api/voice/cartesia', { method: 'POST', headers: { 'x-webhook-secret': 'event' },
      body: JSON.stringify({ type: 'call_turn', call_id: 'ac', webhook_request_id: 'delivery-1', turn: { role: 'assistant', text: 'disclosure', was_interrupted: false } }) });
    const options = { eventSecret: 'event', toolSecret: 'tool', gatewaySecret: 'gateway', gateway: async () => Response.json({}) };
    expect((await createVoiceHandler({ ...options, journal })(event())).status).toBe(200);
    journal = new VoiceJournal(`${dir}/journal.json`);
    expect(await (await createVoiceHandler({ ...options, journal })(event())).json()).toEqual({ duplicate: true });
  } finally { rmSync(dir, { recursive: true }); }
});
