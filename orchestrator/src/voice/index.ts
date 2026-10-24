import { randomUUID } from 'node:crypto';
import { computeEnvelope, DEFAULT_POLICY, evaluate, type Context, type Policy } from '@backroom/policy';

export interface DialInput {
  sessionId: string; agentId: string; fromNumberId: string; clientId: string;
  businessName: string; contactName: string; invoiceId: string; callbackNumber: string;
  client: { type: 'business' | 'consumer'; number: string; timeZone: string; dnc: boolean;
    consent?: { source: string; text: string; timestamp: string; number: string } };
  policy?: Policy; signals?: Context['signals']; demoOverride?: { visible: boolean };
}
export interface VoiceSession {
  id: string; contactName: string; welcome: string; nonce: string; providerCallId?: string;
  disclosureComplete: boolean; userReply: string; stopped: boolean;
  deliveries: Record<string, { fingerprint: string; next: string }>;
}
export interface DialOptions {
  apiKey: string; http?: typeof fetch; now?: Date; allowDemoOverride?: boolean;
  /** Must persist CALL_PERMIT/DEMO_OVERRIDE before any provider request. */
  audit: (entry: { action: string; ruleIds: string[]; sessionId: string; at: string }) => Promise<void>;
  /** Atomically register trusted invoice/client/consent state and an identity=false gateway call. */
  prepare: (session: VoiceSession, input: DialInput) => Promise<void>;
}
export const WELCOME = 'Hi, this is an AI assistant calling on behalf of {{business_name}} about invoice {{invoice_id}}. This call is recorded. Am I speaking with {{contact_name}}?';
export function renderWelcome(input: Pick<DialInput, 'businessName' | 'invoiceId' | 'contactName'>): string {
  return WELCOME.replace('{{business_name}}', input.businessName).replace('{{invoice_id}}', input.invoiceId).replace('{{contact_name}}', input.contactName);
}

// https://docs.cartesia.ai/calhacks and /use-the-api/api-conventions
// Deliberately no automatic retries: a timed-out dial may already be ringing.
export async function cartesiaRequest<T>(apiKey: string, path: string, body?: unknown, http: typeof fetch = fetch, method = body ? 'POST' : 'GET'): Promise<T> {
  const response = await http(`https://api.cartesia.ai${path}`, { method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Cartesia-Version': '2026-08-14', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Cartesia HTTP ${response.status}`); // Never echo destinations/credentials.
  return await response.json() as T;
}

export async function dialCollectionCall(input: DialInput, options: DialOptions) {
  const now = options.now ?? new Date();
  for (const value of [input.sessionId, input.agentId, input.fromNumberId, input.clientId, input.invoiceId]) {
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(value)) throw new Error('INVALID_IDENTIFIER');
  }
  if (![input.businessName, input.contactName].every(v => typeof v === 'string' && v.trim() && v.length <= 120 && !/[{}\r\n]/.test(v))) throw new Error('INVALID_NAME');
  if (!/^\+1\d{10}$/.test(input.client.number) || !/^\+1\d{10}$/.test(input.callbackNumber)) throw new Error('US_E164_REQUIRED');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: input.client.timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const day = parts.find(p => p.type === 'weekday')?.value ?? '';
  const consent = input.client.consent;
  if (consent && Date.parse(consent.timestamp) > now.getTime()) throw new Error('CONSENT_REQUIRED');
  const demo = options.allowDemoOverride === true && input.demoOverride?.visible === true;
  const decision = evaluate('collections', { type: 'call_client' }, {
    policy: input.policy, signals: input.signals,
    client: { type: input.client.type, phoneNumber: input.client.number, dnc: input.client.dnc, consent,
      localWeekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(day), localHour: Number(parts.find(p => p.type === 'hour')?.value) },
    demoOverride: demo ? { visible: true, logged: true } : undefined,
  });
  if (decision.kind !== 'ALLOW') throw new Error(decision.ruleIds.join(','));
  await options.audit({ action: 'CALL_PERMIT', ruleIds: decision.ruleIds, sessionId: input.sessionId, at: now.toISOString() });
  const session: VoiceSession = { id: input.sessionId, contactName: input.contactName, welcome: renderWelcome(input),
    nonce: randomUUID(), disclosureComplete: false, userReply: '', stopped: false, deliveries: {} };
  await options.prepare(session, input);
  // No balance/principal/fee enters the model context before the identity-gated gateway.
  const dynamic_variables = {
    voice_session_id: input.sessionId, delivery_nonce: session.nonce,
    business_name: input.businessName, contact_name: input.contactName, invoice_id: input.invoiceId,
    callback_number: input.callbackNumber,
    envelope_summary: JSON.stringify(computeEnvelope(input.policy ?? DEFAULT_POLICY, input.signals?.active)),
  };
  // https://docs.cartesia.ai/line/integrations/telephony/outbound-dialing
  const result = await cartesiaRequest<{ calls: { agent_call_id?: string; error?: unknown }[] }>(options.apiKey, '/agents/calls', {
    agent_id: input.agentId, from_number_id: input.fromNumberId, ringing_timeout_seconds: 60,
    outbound_calls: [{ to_number: input.client.number, dynamic_variables }],
  }, options.http);
  const call = result.calls?.[0];
  if (!call?.agent_call_id || call.error) throw new Error('DIAL_REJECTED');
  return { sessionId: input.sessionId, callId: call.agent_call_id };
}

/** Conservative interpretation of the provider's actual user turn, never a model's claimed identity. */
export function identityReply(text: string, contactName: string): 'confirmed' | 'wrong_person' | 'uncertain' {
  const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();
  const reply = normalize(text), name = normalize(contactName);
  if (/\b(no|not|wrong|isnt|is not)\b/.test(reply)) return 'wrong_person';
  const accepted = ['yes', 'yep', 'yeah', 'speaking', 'thats me', 'yes thats me', 'yes speaking',
    `this is ${name}`, `${name} here`, `yes this is ${name}`, `yes this is ${name} speaking`, `youre speaking to ${name}`,
    `yeah this is ${name}`, `yeah this is ${name} speaking`, `yep this is ${name}`, `yep this is ${name} speaking`];
  return accepted.includes(reply) ? 'confirmed' : 'uncertain';
}
