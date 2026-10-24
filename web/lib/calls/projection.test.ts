import { describe, expect, it } from 'vitest';
import { createGateway } from '../gateway/http';
import { MemoryGatewayStore, type GatewayCall } from '../gateway/store';
import { MAX_CALL_MS, projectVoiceCall, RING_TIMEOUT_MS } from './projection';

const SESSION = '00000000-0000-4000-8000-000000000001';
const voiceCall = (patch: Partial<GatewayCall> = {}): GatewayCall => ({ callId: SESSION, agentId: 'voice:collections', invoiceId: '1042',
  clientId: 'northfield-jordan', contactName: 'Jordan', companyName: 'Northfield Studio', amountCents: 495000,
  receivable: { principalCents: 480000, lateFeeCents: 15000 }, currency: 'USD', policyVersion: 1, identityConfirmed: false,
  status: 'active', audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {}, ...patch });
async function played(identity: 'confirmed' | 'uncertain') {
  const store = new MemoryGatewayStore([voiceCall()]);
  const gateway = createGateway({ secret: () => 'gateway', store });
  let n = 0;
  const tool = async (name: string, args: object = {}) => (await gateway(name, new Request(`https://gateway.test/api/tools/${name}`, { method: 'POST',
    headers: { authorization: 'Bearer gateway', 'content-type': 'application/json' },
    body: JSON.stringify({ call_id: SESSION, webhook_request_id: `delivery-${++n}`, ...args }) }))).json();
  const plan = (extra: object) => tool('propose_plan', { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0, ...extra });
  await tool('verify_identity_result', { result: identity });
  await plan({ waive_fee: true });
  await plan({ installments: 4 });
  const allowed = await plan({});
  await tool('send_payment_link', { plan_id: allowed.plan_id });
  return (await store.latestVoiceCall())!;
}
const texts = (row: ReturnType<typeof projectVoiceCall>) => row.transcript.map(line => line.text);

describe('desk phone call projection', () => {
  it('renders code decisions, not speech, with amounts after confirmed identity', async () => {
    const call = await played('confirmed');
    const row = projectVoiceCall(call, { registeredAt: 1, startedAt: 2 }, { now: 3 });
    expect(row).toMatchObject({ status: 'live', direction: 'outbound', agentId: 'collections', callerLabel: 'Demo client · invoice 1042', startedAt: 2 });
    expect(texts(row)).toEqual([
      "Identity confirmed from the caller's own answer · amounts unlocked",
      'propose_plan → DENY FEES_NON_WAIVABLE · 2 payments, fee waived',
      expect.stringMatching(/^propose_plan → ESCALATE MAX_INSTALLMENTS.* → Dana · 4 payments$/),
      "Waiting for Dana's passkey decision",
      expect.stringMatching(/^propose_plan → ALLOW.* · 2 payments, first \$2,475\.00$/),
      'Payment link queued · first payment $2,475.00',
    ]);
    const escalation = call.escalations[0]!.id;
    expect(texts(projectVoiceCall(call, {}, { now: 0, escalations: { [escalation]: { status: 'approved', method: 'passkey' } } }))[3]).toBe('Dana approved with a passkey');
    // Only the passkey backend can mark a decision; an unverified status is still pending.
    expect(texts(projectVoiceCall(call, {}, { now: 0, escalations: { [escalation]: { status: 'approved' } } }))[3]).toBe("Waiting for Dana's passkey decision");
  });
  it('masks every amount until identity is confirmed and never exposes contact, number, session or link details', async () => {
    const confirmed = await played('confirmed');
    const masked = projectVoiceCall({ ...confirmed, identityConfirmed: false }, { registeredAt: 1 }, { now: 2 });
    expect(texts(masked).join('\n')).not.toMatch(/\$\d/);
    expect(texts(masked)).toContain('Payment link queued · first payment $•••');
    const link = confirmed.links[0]!;
    const row = projectVoiceCall(confirmed, { registeredAt: 1 }, { now: 2 }), json = JSON.stringify(row);
    for (const secret of [link.shortCode!, link.id, link.path, SESSION, 'Jordan', 'northfield-jordan', confirmed.plans[0]!.id]) expect(json).not.toContain(secret);
    expect([row.callerLabel, ...texts(row)].join('\n')).not.toMatch(/\+?\d[\d ()-]{8,}\d/);
    const uncertain = await played('uncertain');
    expect(texts(projectVoiceCall(uncertain, {}, { now: 0 }))).toEqual(['Identity not confirmed · amounts stay hidden']);
  });
  it('maps lifecycle and gateway stops to ringing, live and ended', () => {
    expect(projectVoiceCall(voiceCall(), { registeredAt: 1000 }, { now: 2000 })).toMatchObject({ status: 'ringing', startedAt: 1000 });
    expect(projectVoiceCall(voiceCall(), { registeredAt: 1000 }, { now: 1001 + RING_TIMEOUT_MS }))
      .toMatchObject({ status: 'ended', endReason: 'No answer', endedAt: 1000 + RING_TIMEOUT_MS });
    expect(projectVoiceCall(voiceCall(), { registeredAt: 1000, startedAt: 1500 }, { now: 2000 }).status).toBe('live');
    expect(projectVoiceCall(voiceCall(), { registeredAt: 1000, startedAt: 1500 }, { now: 1501 + MAX_CALL_MS })).toMatchObject({ status: 'ended', endReason: 'Timed out' });
    expect(projectVoiceCall(voiceCall(), { registeredAt: 1, startedAt: 2, endedAt: 3, endReason: 'completed' }, { now: 4 }))
      .toMatchObject({ status: 'ended', endedAt: 3, endReason: 'Call ended' });
    expect(projectVoiceCall(voiceCall(), { registeredAt: 1, endedAt: 3, endReason: 'failed' }, { now: 4 })).toMatchObject({ status: 'ended', endReason: 'Call failed' });
    expect(projectVoiceCall(voiceCall({ status: 'opted_out' }), { registeredAt: 1, startedAt: 2 }, { now: 4 })).toMatchObject({ status: 'ended', endReason: 'Opt-out recorded' });
  });
});
