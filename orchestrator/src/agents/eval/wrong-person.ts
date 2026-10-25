/** C08 wrong person on the production voice relay: dialCollectionCall builds the session (provider stub,
 * no network), createVoiceHandler handles the caller turn and verify_identity_result over the real tool
 * gateway, and the code-owned reply is graded. Cartesia speaking it and ending the call are not executed. */
import { northfield } from '../../payables';
import { dialCollectionCall, type DialInput, type VoiceSession } from '../../voice/index';
import { createVoiceHandler, VoiceJournal } from '../../voice/server';
import { createGateway } from '../../../../web/lib/gateway/http';
import { MemoryGatewayStore } from '../../../../web/lib/gateway/store';

export async function probeWrongPersonReply() {
  const invoice = northfield.arInvoices.find(row => row.id === '1042')!;
  const client = northfield.clients.find(row => row.id === invoice.clientId)!;
  if (client.type !== 'business' || !client.consent) throw new Error('C08_LEAD_FIXTURE');
  const amountCents = invoice.principalCents + invoice.lateFeeCents;
  const input: DialInput = { sessionId: 'C08:wrong-person', agentId: 'offline-agent', fromNumberId: 'offline-number', clientId: client.id,
    businessName: northfield.company.name, contactName: client.name, invoiceId: invoice.id, callbackNumber: '+12025550100',
    client: { type: 'business', number: client.phoneNumber, timeZone: client.timezone, dnc: client.dnc, consent: client.consent } };
  let session: VoiceSession | undefined, providerRequests = 0;
  await dialCollectionCall(input, { apiKey: 'offline-no-key', now: new Date('2026-10-27T18:00:00Z'), audit: async () => {},
    prepare: async prepared => { session = structuredClone(prepared); },
    http: (async () => { providerRequests++; return Response.json({ calls: [{ agent_call_id: 'offline-call' }] }); }) as typeof fetch });
  if (!session) throw new Error('C08_SESSION_MISSING');
  const journal = new VoiceJournal();
  await journal.register({ ...session, providerCallId: 'offline-call' });
  const store = new MemoryGatewayStore([{ callId: session.id, invoiceId: invoice.id, clientId: client.id, contactName: client.name,
    companyName: northfield.company.name, amountCents, receivable: { principalCents: invoice.principalCents, lateFeeCents: invoice.lateFeeCents },
    currency: 'USD', policyVersion: 1, identityConfirmed: false, status: 'active', audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {} }]);
  const handle = createVoiceHandler({ journal, eventSecret: 'event-secret', toolSecret: 'relay-secret', gatewaySecret: 'gateway-secret',
    gateway: createGateway({ secret: () => 'gateway-secret', store }), answerWaitMs: 0,
    // Scripted stand-in for the Haiku answer reader (no paid call). Code still maps the reading to wrong_person.
    interpretAnswer: async () => ({ kind: 'deny' }) });
  const event = (id: string, turn: Record<string, unknown>) => handle(new Request('https://relay.test/api/voice/cartesia', { method: 'POST',
    headers: { 'x-webhook-secret': 'event-secret' }, body: JSON.stringify({ type: 'call_turn', call_id: 'offline-call', webhook_request_id: id, turn }) }));
  const tool = async (name: string, nonce: string, extra = {}) => (await handle(new Request(`https://relay.test/api/voice/tools/${name}`, {
    method: 'POST', headers: { authorization: 'Bearer relay-secret' },
    body: JSON.stringify({ call_id: session!.id, webhook_request_id: nonce, ...extra }) }))).json() as Promise<Record<string, unknown>>;
  await event('greeting', { role: 'assistant', text: session.welcome, was_interrupted: false });
  await event('caller', { role: 'user', text: 'Who? There is nobody here by that name.', was_interrupted: false });
  const verified = await tool('verify_identity_result', session.nonce, { result: 'wrong_person' });
  const after = await tool('get_invoice_context', String(verified.next_delivery_nonce));
  const speak = String(verified.speak ?? '');
  const leaks = [...client.name.split(/\s+/).filter(word => word.length > 2), invoice.id, String(amountCents),
    (amountCents / 100).toLocaleString('en-US'), '$'];
  const checks = {
    codeOwnedLine: verified.identity === 'wrong_person' && verified.next_step === 'say_and_end' && verified.can_confirm === false,
    businessNameAndCallback: speak.includes(northfield.company.name) && speak.includes('202-555-0100'),
    noContactInvoiceOrAmount: leaks.every(text => !speak.includes(text)),
    accountClosedAfter: JSON.stringify(after.rule_ids) === JSON.stringify(['CALL_STOPPED']),
    oneProviderDialRequest: providerRequests === 1,
  };
  return { match: Object.values(checks).every(Boolean), checks, speak,
    scope: 'Production dialCollectionCall (provider HTTP stub) -> VoiceSession -> production createVoiceHandler relay -> real web tool gateway. The caller line is read by a scripted interpretAnswer (deny) in place of the Haiku reader; code maps it to wrong_person and returns the code-owned line. Without any model reading, code alone classifies this line as uncertain and re-asks. Cartesia speaking the line and the provider end-call are not executed.' };
}
