import { describe, expect, it, vi } from 'vitest';
import { createVoiceHandler, VoiceJournal } from './server';
import { renderWelcome, type VoiceSession } from './index';
import { createGateway } from '../../../web/lib/gateway/http';
import { MemoryGatewayStore, type GatewayCall } from '../../../web/lib/gateway/store';

const call: GatewayCall = { callId: 'session-1', invoiceId: '1042', clientId: 'client-1', contactName: 'Jordan', companyName: 'Northfield Studio',
  amountCents: 495000, receivable: { principalCents: 480000, lateFeeCents: 15000 }, currency: 'USD', policyVersion: 1, identityConfirmed: false,
  status: 'active', audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {} };
const welcome = renderWelcome({ businessName: 'Northfield Studio', invoiceId: '1042', contactName: 'Jordan' });
async function fixture() {
  const journal = new VoiceJournal();
  const session: VoiceSession = { id: 'session-1', contactName: 'Jordan', welcome, nonce: 'nonce-1', providerCallId: 'ac-1', disclosureComplete: false, userReply: '', stopped: false, deliveries: {} };
  await journal.register(session);
  const gateway = vi.fn(createGateway({ secret: () => 'gateway-secret', store: new MemoryGatewayStore([call]) }));
  const handle = createVoiceHandler({ journal, eventSecret: 'event-secret', toolSecret: 'relay-secret', gatewaySecret: 'gateway-secret', gateway });
  const event = (id: string, turn: Record<string, unknown>) => handle(new Request('https://relay.test/api/voice/cartesia', { method: 'POST', headers: { 'x-webhook-secret': 'event-secret' },
    body: JSON.stringify({ type: 'call_turn', call_id: 'ac-1', webhook_request_id: id, turn }) }));
  const tool = async (name: string, nonce: string, extra = {}) => {
    const response = await handle(new Request(`https://relay.test/api/voice/tools/${name}`, { method: 'POST', headers: { authorization: 'Bearer relay-secret' },
      body: JSON.stringify({ call_id: 'session-1', webhook_request_id: nonce, ...extra }) }));
    return { status: response.status, body: await response.json() };
  };
  return { handle, gateway, event, tool };
}
describe('voice HTTP boundary with the actual tool gateway', () => {
  it('keeps invoice data unavailable through interrupted disclosure and unconfirmed identity', async () => {
    const f = await fixture();
    await f.event('turn-1', { role: 'assistant', text: welcome, was_interrupted: true });
    const blocked = await f.tool('get_invoice_context', 'nonce-1');
    expect(blocked.body).toMatchObject({ can_confirm: false, rule_ids: ['DISCLOSURE_REQUIRED'] });
    expect(f.gateway).not.toHaveBeenCalled();
    await f.event('turn-2', { role: 'assistant', text: welcome, was_interrupted: false });
    const unknown = await f.tool('get_invoice_context', blocked.body.next_delivery_nonce);
    expect(unknown.body).toMatchObject({ rule_ids: ['IDENTITY_REQUIRED'] });
    expect(unknown.body).not.toHaveProperty('amount_cents');
  });
  it('uses actual natural identity evidence and allows only a policy-authorized plan/link', async () => {
    const f = await fixture();
    await f.event('background', { role: 'user', text: 'Yes.', was_interrupted: false });
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    // Claiming confirmed without a caller turn cannot unlock details.
    let result = await f.tool('verify_identity_result', 'nonce-1', { result: 'confirmed' });
    let context = await f.tool('get_invoice_context', result.body.next_delivery_nonce);
    expect(context.body).not.toHaveProperty('amount_cents');
    await f.event('identity', { role: 'user', text: "That's me!", was_interrupted: false });
    result = await f.tool('verify_identity_result', context.body.next_delivery_nonce, { result: 'confirmed' });
    context = await f.tool('get_invoice_context', result.body.next_delivery_nonce);
    expect(context.body.amount_cents).toBe(495000);
    const proposed = await f.tool('propose_plan', context.body.next_delivery_nonce, { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
    expect(proposed.body).toMatchObject({ kind: 'ALLOW', can_confirm: true, plan: { firstPaymentCents: 247500 } });
    const link = await f.tool('send_payment_link', proposed.body.next_delivery_nonce, { plan_id: proposed.body.plan_id });
    expect(link.body).toMatchObject({ kind: 'RECORDED', can_confirm: false, amount_cents: 247500 });
  });
  it('records tool-only assistant turns without text without unlocking disclosure or identity', async () => {
    const f = await fixture();
    const turn = { role: 'assistant', was_interrupted: false, tool_calls: [{ name: 'verify_identity_result', arguments: { result: 'confirmed' }, result: '{}' }] };
    expect((await f.event('null-tool-only', { ...turn, text: null })).status).toBe(200);
    const receipt = await f.event('tool-only', turn);
    expect(receipt.status).toBe(200);
    expect(await (await f.event('tool-only', turn)).json()).toEqual({ duplicate: true });
    expect((await f.event('missing-user-text', { ...turn, role: 'user' })).status).toBe(400);
    expect((await f.event('missing-assistant-text', { role: 'assistant' })).status).toBe(400);
    const blocked = await f.tool('get_invoice_context', 'nonce-1');
    expect(blocked.body.rule_ids).toEqual(['DISCLOSURE_REQUIRED']);
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('second-tool-only', turn);
    const identity = await f.tool('verify_identity_result', blocked.body.next_delivery_nonce, { result: 'confirmed' });
    expect((await f.tool('get_invoice_context', identity.body.next_delivery_nonce)).body.rule_ids).toEqual(['IDENTITY_REQUIRED']);
  });
  it('ends the identity path after a wrong-person answer even if later tools claim confirmation', async () => {
    const f = await fixture();
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('wrong', { role: 'user', text: 'No, wrong person.', was_interrupted: false });
    const verified = await f.tool('verify_identity_result', 'nonce-1', { result: 'confirmed' });
    await f.event('later', { role: 'user', text: 'Yes.', was_interrupted: false });
    const again = await f.tool('verify_identity_result', verified.body.next_delivery_nonce, { result: 'confirmed' });
    expect(again.body.rule_ids).toEqual(['CALL_STOPPED']);
    expect(f.gateway).toHaveBeenCalledTimes(1);
  });
  it('deduplicates concurrent call_turn deliveries and tool retries without replaying ALLOW', async () => {
    const f = await fixture();
    const results = await Promise.all([f.event('optout', { role: 'user', text: 'Stop calling me.', was_interrupted: false }), f.event('optout', { role: 'user', text: 'Stop calling me.', was_interrupted: false })]);
    expect(await results[1]!.json()).toEqual({ duplicate: true });
    expect(f.gateway).toHaveBeenCalledTimes(1);
    const first = await f.tool('request_human', 'nonce-1');
    const retry = await f.tool('request_human', 'nonce-1');
    expect(retry.body).toMatchObject({ duplicate: true, can_confirm: false, next_delivery_nonce: first.body.next_delivery_nonce });
    expect(f.gateway).toHaveBeenCalledTimes(2);
    const changed = await f.tool('record_opt_out', 'nonce-1');
    expect(changed.status).toBe(409);
    const stopped = await f.tool('get_invoice_context', first.body.next_delivery_nonce);
    expect(stopped.body.rule_ids).toEqual(['CALL_STOPPED']);
  });
  it('stops on bankruptcy before a later invoice or plan tool can run', async () => {
    const f = await fixture();
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('bankruptcy', { role: 'user', text: 'We filed for bankruptcy.', was_interrupted: false });
    const blocked = await f.tool('get_invoice_context', 'nonce-1');
    expect(blocked.body.rule_ids).toEqual(['CALL_STOPPED']);
    expect(f.gateway).toHaveBeenCalledTimes(1);
    expect(f.gateway.mock.calls[0]?.[0]).toBe('request_human');
  });
  it('rejects unauthenticated, malformed, and invented invocation identifiers', async () => {
    const f = await fixture();
    const unauthorized = await f.handle(new Request('https://relay.test/api/voice/cartesia', { method: 'POST', headers: { 'x-webhook-secret': 'évent-secret' }, body: '{}' }));
    expect(unauthorized.status).toBe(401);
    const malformed = await f.handle(new Request('https://relay.test/api/voice/cartesia', { method: 'POST', headers: { 'x-webhook-secret': 'event-secret' }, body: '{' }));
    expect(malformed.status).toBe(400);
    expect((await f.tool('record_opt_out', 'invented-nonce')).status).toBe(409);
    expect((await f.tool('approve_payment', 'nonce-1')).status).toBe(404);
    expect(f.gateway).not.toHaveBeenCalled();
  });
});
