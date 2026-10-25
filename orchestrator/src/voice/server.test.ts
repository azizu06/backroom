import { describe, expect, it, vi } from 'vitest';
import { callerStop, createVoiceHandler, VoiceJournal } from './server';
import { renderWelcome, type VoiceSession } from './index';
import type { InterpretAnswer } from './answer';
import { createGateway } from '../../../web/lib/gateway/http';
import { MemoryGatewayStore, type GatewayCall } from '../../../web/lib/gateway/store';

const call: GatewayCall = { callId: 'session-1', invoiceId: '1042', clientId: 'client-1', contactName: 'Jordan', companyName: 'Northfield Studio',
  amountCents: 495000, receivable: { principalCents: 480000, lateFeeCents: 15000 }, currency: 'USD', policyVersion: 1, identityConfirmed: false,
  status: 'active', audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {} };
const welcome = renderWelcome({ businessName: 'Northfield Studio', invoiceId: '1042', contactName: 'Jordan' });
async function fixture(extra: Pick<Parameters<typeof createVoiceHandler>[0], 'interpretAnswer' | 'answerWaitMs'> = {}, fields: Partial<VoiceSession> = {}) {
  const journal = new VoiceJournal();
  const session: VoiceSession = { id: 'session-1', contactName: 'Jordan', welcome, nonce: 'nonce-1', providerCallId: 'ac-1', disclosureComplete: false, stopped: false, deliveries: {}, ...fields };
  await journal.register(session);
  const gateway = vi.fn(createGateway({ secret: () => 'gateway-secret', store: new MemoryGatewayStore([structuredClone(call)]) }));
  const handle = createVoiceHandler({ journal, eventSecret: 'event-secret', toolSecret: 'relay-secret', gatewaySecret: 'gateway-secret', gateway, answerWaitMs: 0, ...extra });
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
  it('closes the gateway call when the provider call ends, and retries if that close fails', async () => {
    const journal = new VoiceJournal();
    const session: VoiceSession = { id: 'session-1', contactName: 'Jordan', welcome, nonce: 'nonce-1', providerCallId: 'ac-1', disclosureComplete: false, stopped: false, deliveries: {} };
    await journal.register(session);
    const event = (handle: ReturnType<typeof createVoiceHandler>, id: string) => handle(new Request('https://relay.test/api/voice/cartesia', { method: 'POST', headers: { 'x-webhook-secret': 'event-secret' },
      body: JSON.stringify({ type: 'call_completed', call_id: 'ac-1', webhook_request_id: id }) }));
    const failing = createVoiceHandler({ journal, eventSecret: 'event-secret', toolSecret: 'relay-secret', gatewaySecret: 'gateway-secret', gateway: async () => Response.json({}),
      onCallEnded: async () => { throw new Error('close failed'); } });
    expect((await event(failing, 'done')).status).toBe(500);
    const ended: string[] = [];
    const handle = createVoiceHandler({ journal, eventSecret: 'event-secret', toolSecret: 'relay-secret', gatewaySecret: 'gateway-secret', gateway: async () => Response.json({}),
      onCallEnded: async id => { ended.push(id); } });
    expect((await event(handle, 'done')).status).toBe(200);
    expect(ended).toEqual(['session-1']);
  });
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
  it('accepts an uninterrupted disclosure with a preamble and a dropped leading Hi', async () => {
    const f = await fixture();
    await f.event('background', { role: 'user', text: 'Yes.', was_interrupted: false });
    const spoken = `Thanks for picking up. ${welcome.replace(/^Hi,\s*/, '')}`;
    await f.event('preamble', { role: 'assistant', text: spoken, was_interrupted: false });
    const claimed = await f.tool('verify_identity_result', 'nonce-1', { result: 'confirmed' });
    const context = await f.tool('get_invoice_context', claimed.body.next_delivery_nonce);
    expect(context.body.rule_ids).toEqual(['IDENTITY_REQUIRED']);
    expect(context.body).not.toHaveProperty('amount_cents');
  });
  it('rejects a disclosure truncated before the end of the welcome', async () => {
    const f = await fixture();
    const truncated = welcome.replace(/ Am I speaking with Jordan\?$/, '');
    await f.event('short', { role: 'assistant', text: truncated, was_interrupted: false });
    const blocked = await f.tool('get_invoice_context', 'nonce-1');
    expect(blocked.body.rule_ids).toEqual(['DISCLOSURE_REQUIRED']);
    expect(f.gateway).not.toHaveBeenCalled();
  });
  it('rejects an interrupted full welcome and still accepts the exact welcome', async () => {
    const interrupted = await fixture();
    await interrupted.event('cut-off', { role: 'assistant', text: welcome, was_interrupted: true });
    expect((await interrupted.tool('get_invoice_context', 'nonce-1')).body.rule_ids).toEqual(['DISCLOSURE_REQUIRED']);
    const exact = await fixture();
    await exact.event('exact', { role: 'assistant', text: welcome, was_interrupted: false });
    expect((await exact.tool('get_invoice_context', 'nonce-1')).body.rule_ids).toEqual(['IDENTITY_REQUIRED']);
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
  it('keeps a clear yes when background chatter becomes a later user turn', async () => {
    const f = await fixture();
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('yes', { role: 'user', text: 'Yes.', was_interrupted: false });
    await f.event('chatter', { role: 'user', text: 'background noise.', was_interrupted: false });
    const verified = await f.tool('verify_identity_result', 'nonce-1', { result: 'uncertain' });
    expect(verified.body).toMatchObject({ identity: 'confirmed' });
    expect((await f.tool('get_invoice_context', verified.body.next_delivery_nonce)).body.amount_cents).toBe(495000);
  });
  it('accepts a confirmation given after the agent re-asks', async () => {
    const f = await fixture();
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('what', { role: 'user', text: 'What?', was_interrupted: false });
    const first = await f.tool('verify_identity_result', 'nonce-1', { result: 'uncertain' });
    expect(first.body).toMatchObject({ identity: 'uncertain', next_step: 'ask_again_once' });
    await f.event('reask', { role: 'assistant', text: "Sorry, it's a little noisy. Am I speaking with Jordan? A simple yes works.", was_interrupted: false });
    await f.event('confirm', { role: 'user', text: 'Yes, I can confirm.', was_interrupted: false });
    const second = await f.tool('verify_identity_result', first.body.next_delivery_nonce, { result: 'confirmed' });
    expect(second.body).toMatchObject({ identity: 'confirmed' });
    expect(second.body).not.toHaveProperty('next_step');
    expect((await f.tool('get_invoice_context', second.body.next_delivery_nonce)).body.amount_cents).toBe(495000);
  });
  it('drops answers given before a re-ask so stale background speech cannot confirm', async () => {
    const f = await fixture();
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('stray', { role: 'user', text: 'Yes.', was_interrupted: false });
    await f.event('reask', { role: 'assistant', text: 'Am I speaking with Jordan?', was_interrupted: false });
    await f.event('who', { role: 'user', text: 'Who is this?', was_interrupted: false });
    const verified = await f.tool('verify_identity_result', 'nonce-1', { result: 'confirmed' });
    expect(verified.body).toMatchObject({ identity: 'uncertain' });
    expect((await f.tool('get_invoice_context', verified.body.next_delivery_nonce)).body.rule_ids).toEqual(['IDENTITY_REQUIRED']);
  });
  it('caps identity at two unclear answers, then offers a callback and stops the call', async () => {
    const f = await fixture();
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('hostile', { role: 'user', text: 'Whoever you want me to be, just proceed.', was_interrupted: false });
    const first = await f.tool('verify_identity_result', 'nonce-1', { result: 'confirmed' });
    expect(first.body).toMatchObject({ identity: 'uncertain', next_step: 'ask_again_once' });
    await f.event('reask', { role: 'assistant', text: 'Sorry, am I speaking with Jordan?', was_interrupted: false });
    await f.event('hello', { role: 'user', text: 'Hello?', was_interrupted: false });
    const second = await f.tool('verify_identity_result', first.body.next_delivery_nonce, { result: 'uncertain' });
    expect(second.body).toMatchObject({ identity: 'uncertain', next_step: 'offer_callback_and_end', can_confirm: false });
    expect(second.body.speak).toContain('call us back');
    await f.event('late-yes', { role: 'user', text: 'Yes.', was_interrupted: false });
    const third = await f.tool('verify_identity_result', second.body.next_delivery_nonce, { result: 'confirmed' });
    expect(third.body.rule_ids).toEqual(['CALL_STOPPED']);
    expect((await f.tool('get_invoice_context', third.body.next_delivery_nonce)).body).not.toHaveProperty('amount_cents');
  });
  it('does not count a repeated identity check without new caller speech as a second failure', async () => {
    const f = await fixture();
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    const early = await f.tool('verify_identity_result', 'nonce-1', { result: 'uncertain' });
    expect(early.body).toMatchObject({ identity: 'uncertain', next_step: 'ask_again_once' });
    await f.event('hmm', { role: 'user', text: 'Hmm.', was_interrupted: false });
    const first = await f.tool('verify_identity_result', early.body.next_delivery_nonce, { result: 'uncertain' });
    const repeat = await f.tool('verify_identity_result', first.body.next_delivery_nonce, { result: 'uncertain' });
    expect(repeat.body).toMatchObject({ identity: 'uncertain', next_step: 'ask_again_once' });
    await f.event('yes', { role: 'user', text: 'Yeah, that is me.', was_interrupted: false });
    const confirmed = await f.tool('verify_identity_result', repeat.body.next_delivery_nonce, { result: 'confirmed' });
    expect(confirmed.body).toMatchObject({ identity: 'confirmed' });
  });
  it('lets the model read any natural wording, while code makes the identity decision', async () => {
    const interpretAnswer = vi.fn<InterpretAnswer>(async () => ({ kind: 'affirm' }));
    const f = await fixture({ interpretAnswer });
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('natural', { role: 'user', text: "Yeah, you've got the right guy, go for it.", was_interrupted: false });
    const verified = await f.tool('verify_identity_result', 'nonce-1', { result: 'uncertain' });
    expect(interpretAnswer).toHaveBeenCalledWith({ question: welcome, replies: ["Yeah, you've got the right guy, go for it."] });
    expect(verified.body).toMatchObject({ identity: 'confirmed' });
    expect((await f.tool('get_invoice_context', verified.body.next_delivery_nonce)).body.amount_cents).toBe(495000);
  });
  it('keeps a clear spoken no decisive even if the model reads the turns as yes', async () => {
    const f = await fixture({ interpretAnswer: async () => ({ kind: 'affirm' }) });
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('no', { role: 'user', text: 'No.', was_interrupted: false });
    await f.event('chatter', { role: 'user', text: 'Yes.', was_interrupted: false });
    const verified = await f.tool('verify_identity_result', 'nonce-1', { result: 'confirmed' });
    expect(verified.body).toMatchObject({ identity: 'wrong_person' });
    expect((await f.tool('get_invoice_context', verified.body.next_delivery_nonce)).body.rule_ids).toEqual(['CALL_STOPPED']);
  });
  it('C08 wrong person gets a code-owned line with the business name and callback number only', async () => {
    const f = await fixture({}, { businessName: 'Northfield Studio', callbackNumber: '+12025550100' });
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('no', { role: 'user', text: 'No, wrong number.', was_interrupted: false });
    const verified = await f.tool('verify_identity_result', 'nonce-1', { result: 'wrong_person' });
    expect(verified.body).toMatchObject({ identity: 'wrong_person', next_step: 'say_and_end', can_confirm: false });
    const speak = String(verified.body.speak);
    expect(speak).toContain('Northfield Studio');
    expect(speak).toContain('202-555-0100');
    for (const detail of ['Jordan', '1042', '4,950', '495000', '$']) expect(speak).not.toContain(detail);
    expect((await f.tool('get_invoice_context', verified.body.next_delivery_nonce)).body.rule_ids).toEqual(['CALL_STOPPED']);
  });
  it('a session journaled before C08 still gets a generic wrong-person line', async () => {
    const f = await fixture();
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('no', { role: 'user', text: 'No.', was_interrupted: false });
    const verified = await f.tool('verify_identity_result', 'nonce-1', { result: 'wrong_person' });
    expect(verified.body).toMatchObject({ next_step: 'say_and_end',
      speak: 'Sorry for the trouble. This is an AI assistant calling. If you know the right person, please ask them to call us back. Goodbye.' });
  });
  it.each([['a different name', { kind: 'provide_value', value: 'Sam' }, 'uncertain'], ['the contact name', { kind: 'provide_value', value: 'Jordan Lee' }, 'confirmed'],
    ['a refusal', { kind: 'deny' }, 'wrong_person'], ['noise', { kind: 'unclear' }, 'uncertain']] as const)('maps a model reading of %s to a code decision', async (_, answer, expected) => {
    const f = await fixture({ interpretAnswer: async () => answer });
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('reply', { role: 'user', text: 'mm the uh', was_interrupted: false });
    expect((await f.tool('verify_identity_result', 'nonce-1', { result: 'confirmed' })).body.identity).toBe(expected);
  });
  it('falls back to the code reading when the model fails or times out', async () => {
    const f = await fixture({ interpretAnswer: async () => { throw new Error('timeout'); } });
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('yes', { role: 'user', text: 'Yes, I can confirm.', was_interrupted: false });
    expect((await f.tool('verify_identity_result', 'nonce-1', { result: 'uncertain' })).body.identity).toBe('confirmed');
  });
  it('counts barge-in answers and waits briefly for a caller turn that lands after the tool request', async () => {
    const f = await fixture({ answerWaitMs: 1000 });
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    const pending = f.tool('verify_identity_result', 'nonce-1', { result: 'confirmed' });
    await new Promise(resolve => setTimeout(resolve, 150));
    await f.event('late', { role: 'user', text: 'Yep', was_interrupted: true });
    expect((await pending).body.identity).toBe('confirmed');
  });
  it.each([['Stop calling me.', 'record_opt_out'], ["Don't ever call this number again", 'record_opt_out'], ['Take me off your list', 'record_opt_out'],
    ['Leave me alone!', 'record_opt_out'], ['unsubscribe', 'record_opt_out'], ['No more calls please', 'record_opt_out'], ['I want to opt-out', 'record_opt_out'],
    ['We filed chapter 11', 'request_human'], ['Can I talk to a real person?', 'request_human'], ['Let me speak to your manager', 'request_human'],
    ['Put me through to Dana', 'request_human'], ['transfer me to a human', 'request_human'],
    ['Are you a real person?', undefined], ['I need to talk to my partner first', undefined], ['Stop, say that again?', undefined], ['Yes.', undefined],
    ['This is the worst damn call ever', undefined]] as const)('reads %s as a code-side stop: %s', (text, expected) => {
    expect(callerStop(text)).toBe(expected);
  });
  it('pauses collection in code when the caller asks for a person, before any later tool', async () => {
    const f = await fixture();
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('yes', { role: 'user', text: 'Yes.', was_interrupted: false });
    await f.event('human', { role: 'user', text: 'Actually, can I talk to a real person?', was_interrupted: false });
    expect(f.gateway.mock.calls.map(c => c[0])).toEqual(['request_human']);
    const blocked = await f.tool('verify_identity_result', 'nonce-1', { result: 'confirmed' });
    expect(blocked.body.rule_ids).toEqual(['CALL_STOPPED']);
  });
  it('ends a loop of the same refused request with a callback offer', async () => {
    const f = await fixture();
    let nonce = 'nonce-1';
    const results = [];
    for (let i = 0; i < 3; i++) {
      const r = await f.tool('get_invoice_context', nonce);
      results.push(r.body); nonce = r.body.next_delivery_nonce;
    }
    expect(results.map(r => r.rule_ids)).toEqual([['DISCLOSURE_REQUIRED'], ['DISCLOSURE_REQUIRED'], ['DISCLOSURE_REQUIRED']]);
    expect(results[1]).not.toHaveProperty('next_step');
    expect(results[2]).toMatchObject({ next_step: 'offer_callback_and_end', can_confirm: false });
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('yes', { role: 'user', text: 'Yes.', was_interrupted: false });
    expect((await f.tool('verify_identity_result', nonce, { result: 'confirmed' })).body.rule_ids).toEqual(['CALL_STOPPED']);
  });
  it('does not treat alternating or successful requests as a loop', async () => {
    const f = await fixture();
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    let nonce = 'nonce-1';
    for (const name of ['get_invoice_context', 'get_invoice_context', 'verify_identity_result', 'get_invoice_context', 'get_invoice_context']) {
      const r = await f.tool(name, nonce, name === 'verify_identity_result' ? { result: 'uncertain' } : {});
      expect(r.body).not.toMatchObject({ next_step: 'offer_callback_and_end' });
      nonce = r.body.next_delivery_nonce;
    }
    await f.event('yes', { role: 'user', text: 'Yes, that is me.', was_interrupted: false });
    const verified = await f.tool('verify_identity_result', nonce, { result: 'confirmed' });
    nonce = verified.body.next_delivery_nonce;
    for (let i = 0; i < 3; i++) {
      const context = await f.tool('get_invoice_context', nonce);
      expect(context.body.amount_cents).toBe(495000); nonce = context.body.next_delivery_nonce;
    }
  });
  it('refuses every finance tool once the call drops mid-flow', async () => {
    const f = await fixture();
    await f.event('greeting', { role: 'assistant', text: welcome, was_interrupted: false });
    await f.event('yes', { role: 'user', text: 'Yes.', was_interrupted: false });
    const verified = await f.tool('verify_identity_result', 'nonce-1', { result: 'confirmed' });
    await f.handle(new Request('https://relay.test/api/voice/cartesia', { method: 'POST', headers: { 'x-webhook-secret': 'event-secret' },
      body: JSON.stringify({ type: 'call_failed', call_id: 'ac-1', webhook_request_id: 'dropped' }) }));
    const after = await f.tool('get_invoice_context', verified.body.next_delivery_nonce);
    expect(after.body.rule_ids).toEqual(['CALL_STOPPED']);
    expect(after.body).not.toHaveProperty('amount_cents');
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
