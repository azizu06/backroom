import { describe, expect, it } from 'vitest';
import { MemoryStateStore } from '../store';
import { EMAIL_LABEL, MemoryEmailOutbox, runEmailFollowUp, type EmailFollowUpInput } from './email';

const consent = { source: 'contract', text: 'I consent', timestamp: '2026-07-01T17:00:00Z', number: '+12025550103' };
const client = (over: Record<string, unknown> = {}) => ({ type: 'business' as const, phoneNumber: '+12025550103', dnc: false, localWeekday: 2, localHour: 11, consent, ...over });
const input = (over: Partial<EmailFollowUpInput> = {}, clientOver: Record<string, unknown> = {}): EmailFollowUpInput => ({
  clientId: 'client-03', invoiceId: '1043', businessName: 'Northfield Studio', contactName: 'Riley', email: 'riley@harbor.example',
  callbackNumber: '+12025550100', context: { client: client(clientOver) as never }, ...over });
function harness() {
  const audit = new MemoryStateStore();
  const outbox = new MemoryEmailOutbox();
  return { audit, outbox, deps: { audit, outbox, now: () => Date.parse('2026-10-24T18:00:00Z') } };
}

describe('email-only follow-up (C14)', () => {
  it.each([
    ['consumer client', { type: 'consumer' }, 'B2B_ONLY_CALLS'],
    ['opted-out client', { dnc: true }, 'DNC'],
    ['no call consent', { consent: undefined }, 'CONSENT_REQUIRED'],
  ])('%s gets a simulated email instead of a call, with no amount or invoice detail', async (_name, over, rule) => {
    const h = harness();
    expect(await runEmailFollowUp(input({}, over), h.deps)).toMatchObject({ status: 'queued', withLink: false, ruleIds: [rule] });
    const [email] = h.outbox.sent;
    expect(email).toMatchObject({ to: 'riley@harbor.example', label: EMAIL_LABEL });
    expect(email!.body).toContain('AI assistant on behalf of Northfield Studio');
    expect(email!.body).toContain('reply STOP');
    expect(email!.body).toContain('+12025550100');
    expect(email!.body).not.toMatch(/1043|\$|760/);
    const row = (await h.audit.listAudit()).find(entry => entry.action === 'email_followup_queued');
    expect(row).toMatchObject({ decision: 'ALLOW', ruleIds: [rule], inputs: { channel: 'email', simulated: true, toDomain: 'harbor.example', withLink: false } });
    expect(JSON.stringify(row)).not.toContain('riley@');
  });

  it('a client who can be called gets no email', async () => {
    const h = harness();
    expect(await runEmailFollowUp(input(), h.deps)).toEqual({ status: 'not_needed', reason: 'CALL_ALLOWED' });
    expect(h.outbox.sent).toEqual([]);
  });

  it.each([
    ['bankruptcy', { bankruptcy: true }, 'BANKRUPTCY_STOP'],
    ['OFAC hit', { ofacHit: true }, 'OFAC_STOP'],
    ['closed business', { closedBusiness: true }, 'CLOSED_BUSINESS_STOP'],
    ['dispute', { disputed: true }, 'DISPUTE_STOP'],
  ])('a %s ends all contact: no email even for an email-only consumer, and the audit row is the policy decision', async (_name, signals, rule) => {
    const h = harness();
    const run = await runEmailFollowUp({ ...input(), context: { client: client({ type: 'consumer' }) as never, signals } }, h.deps);
    expect(run).toMatchObject({ status: 'blocked', reason: rule, decision: { kind: 'ESCALATE', ruleIds: [rule] } });
    expect(h.outbox.sent).toEqual([]);
    expect((await h.audit.listAudit()).at(-1)).toMatchObject({ action: 'email_followup_blocked', decision: 'ESCALATE', ruleIds: [rule] });
  });

  it('outside calling hours a callable business is a retry later, not an email', async () => {
    const h = harness();
    expect(await runEmailFollowUp(input({}, { localHour: 22 }), h.deps)).toMatchObject({ status: 'blocked', reason: 'NOT_EMAIL_ELIGIBLE' });
    expect(h.outbox.sent).toEqual([]);
  });

  it.each([
    ['consumer', { type: 'consumer' }],
    ['opted-out client', { dnc: true }],
    ['no-consent client', { consent: undefined }],
  ])('a %s outside the contact window gets no email', async (_name, over) => {
    for (const [time, rule] of [[{ localHour: 22 }, 'CALL_WINDOW'], [{ localWeekday: 0, localHour: 11 }, 'CALL_WINDOW'],
      [{ localHour: Number.NaN }, 'INVALID_INPUT'], [{ localWeekday: 9 }, 'INVALID_INPUT']] as const) {
      const h = harness();
      expect(await runEmailFollowUp(input({}, { ...over, ...time }), h.deps)).toMatchObject({ status: 'blocked', reason: rule, decision: { kind: 'DENY', ruleIds: [rule] } });
      expect(h.outbox.sent).toEqual([]);
      expect((await h.audit.listAudit()).at(-1)).toMatchObject({ action: 'email_followup_blocked', decision: 'DENY', ruleIds: [rule] });
    }
  });

  it('a visible, logged demo override lets an after-hours email-only follow-up queue, and says so', async () => {
    const h = harness();
    const late = input({}, { type: 'consumer', localHour: 22 });
    const hidden = await runEmailFollowUp({ ...late, context: { ...late.context, demoOverride: { visible: true, logged: false } } }, h.deps);
    expect(hidden).toMatchObject({ status: 'blocked', reason: 'CALL_WINDOW' });
    const shown = await runEmailFollowUp({ ...late, context: { ...late.context, demoOverride: { visible: true, logged: true } } }, h.deps);
    expect(shown).toMatchObject({ status: 'queued', ruleIds: ['B2B_ONLY_CALLS', 'DEMO_OVERRIDE'] });
    expect((await h.audit.listAudit()).at(-1)).toMatchObject({ action: 'email_followup_queued', ruleIds: ['B2B_ONLY_CALLS', 'DEMO_OVERRIDE'] });
  });

  it('refuses without an address on file', async () => {
    const h = harness();
    expect(await runEmailFollowUp(input({ email: undefined }, { type: 'consumer' }), h.deps)).toMatchObject({ status: 'blocked', reason: 'NO_EMAIL_ON_FILE' });
  });

  it('sends at most one verify email per invoice per day', async () => {
    const h = harness();
    await runEmailFollowUp(input({}, { type: 'consumer' }), h.deps);
    expect(await runEmailFollowUp(input({}, { type: 'consumer' }), h.deps)).toMatchObject({ status: 'duplicate' });
    expect(h.outbox.sent).toHaveLength(1);
  });

  it('attaches the pay link only when identity is verified, and still sends one email per invoice per day', async () => {
    const payLink = { id: 'link-1043', url: 'https://demo.example/pay/link-1043' };
    const h = harness();
    expect(await runEmailFollowUp(input({ payLink }, { type: 'consumer' }), h.deps)).toMatchObject({ status: 'queued', withLink: false, key: 'email:1043:2026-10-24' });
    expect(h.outbox.sent[0]!.body).not.toContain('/pay/');
    expect(h.outbox.sent[0]).not.toHaveProperty('linkId');
    // Verifying later the same day does not earn a second email.
    expect(await runEmailFollowUp(input({ payLink, identityVerified: true }, { type: 'consumer' }), h.deps)).toMatchObject({ status: 'duplicate', key: 'email:1043:2026-10-24' });
    expect(h.outbox.sent).toHaveLength(1);
    // A verified contact on a fresh day gets the link.
    const next = harness();
    expect(await runEmailFollowUp(input({ payLink, identityVerified: true }, { type: 'consumer' }), next.deps)).toMatchObject({ status: 'queued', withLink: true });
    expect(next.outbox.sent[0]).toMatchObject({ linkId: 'link-1043' });
    expect(next.outbox.sent[0]!.body).toContain('https://demo.example/pay/link-1043');
  });
});
