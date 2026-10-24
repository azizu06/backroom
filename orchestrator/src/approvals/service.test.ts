import { describe, expect, it } from 'vitest';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { ControllerApprovals } from './service';
import { approvalWindowMs } from './window';
import { MemoryStateStore } from '../store';
import type { VerifiedApproval } from './verified';
import { TestAuthenticator } from './testing/authenticator';
import type { ControllerDecision } from './types';
import { evaluate } from '@backroom/policy';

const terms = { installments: 4, firstPaymentPct: 50, durationDays: 30, waiveFee: false, discountPct: 0 };
async function setup(enroll = true) {
  let now = 1000;
  const store = new MemoryStateStore();
  const service = new ControllerApprovals(store,
    { origin: 'http://localhost:3020', rpID: 'localhost', enrollmentSecret: 'test-enrollment' }, () => now);
  const auth = new TestAuthenticator();
  if (enroll) {
    const { options, challengeId } = await service.registrationOptions('test-enrollment');
    await service.register('test-enrollment', challengeId, auth.registration(options.challenge));
  }
  await store.insertInvoice({ id: '1042', kind: 'ar', state: 'in_collection' });
  const create = async (id = 'e1') => store.createCallEscalation({ id, taskId: 't1', callId: 'c1', fromAgent: 'collections-1',
    toHuman: 'Dana', seat: 'collections', evidenceRefs: ['audit:1', '1042'], ruleIds: ['MAX_INSTALLMENTS'],
    invoiceId: '1042', policyVersion: 1, quote: { sentenceId: 'NF-005', text: 'At most two installments.' },
    amountCents: 495000, principalCents: 480000, lateFeeCents: 15000, currency: 'USD', requestedTerms: terms }, now);
  await create();
  return { store, service, auth, create, advance: (n: number) => { now += n; } };
}

describe('M6 server-verified controller authority', () => {
  it('requires private enrollment authority and verifies registration before replacing nothing', async () => {
    const { service, auth } = await setup(false);
    await expect(service.registrationOptions('wrong')).rejects.toThrow('ENROLLMENT_UNAUTHORIZED');
    expect(service.isRegistered()).toBe(false);
    const { options, challengeId } = await service.registrationOptions('test-enrollment');
    await service.register('test-enrollment', challengeId, auth.registration(options.challenge));
    expect(service.isRegistered()).toBe(true);
    await expect(service.registrationOptions('test-enrollment')).rejects.toThrow('CONTROLLER_ALREADY_REGISTERED');
  });

  it.each<ControllerDecision>([{ kind: 'Approve' }, { kind: 'Deny' }, { kind: 'Counter', terms: { ...terms, installments: 2 } }])(
    'records $kind only after a real signed UV assertion and retains exact evidence', async decision => {
      const { store, service, auth } = await setup();
      const { options, challengeId } = await service.decisionOptions('e1', decision);
      const row = await service.decide('e1', challengeId, auth.assertion(options.challenge));
      expect(row).toMatchObject({ decision, method: 'passkey', credentialId: auth.id, decidedAt: 1000,
        amountCents: 495000, quote: { text: 'At most two installments.' } });
      expect((await store.listAudit()).at(-1)).toMatchObject({ actor: 'human', action: 'decide_escalation', inputs: { decision } });
      expect((await store.getAgent('collections-1'))?.targetAnchor).toBe('Dana_desk');
    },
  );

  it.each(['missing', 'forged signature', 'wrong origin', 'wrong RP', 'no user verification'])(
    'rejects %s and leaves the request pending', async attack => {
      const { store, service, auth } = await setup();
      const { options, challengeId } = await service.decisionOptions('e1', { kind: 'Approve' });
      const response = auth.assertion(options.challenge, {
        ...(attack === 'wrong origin' && { origin: 'https://evil.example' }),
        ...(attack === 'wrong RP' && { rpID: 'evil.example' }),
        ...(attack === 'no user verification' && { verified: false }),
      });
      if (attack === 'forged signature') response.response.signature = Buffer.alloc(70).toString('base64url');
      await expect(service.decide('e1', challengeId, attack === 'missing' ? {} as AuthenticationResponseJSON : response)).rejects.toThrow();
      expect((await store.getEscalation('e1'))?.status).toBe('pending');
    },
  );

  it('consumes a challenge before async verification so racing and replayed assertions lose', async () => {
    const { service, auth, store } = await setup();
    const { options, challengeId } = await service.decisionOptions('e1', { kind: 'Approve' });
    const response = auth.assertion(options.challenge);
    const attempts = await Promise.allSettled([service.decide('e1', challengeId, response), service.decide('e1', challengeId, response)]);
    expect(attempts.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    await expect(service.decide('e1', challengeId, response)).rejects.toThrow('CHALLENGE_INVALID');
    expect((await store.listAudit()).filter(e => e.action === 'decide_escalation')).toHaveLength(1);
  });

  it('binds the challenge to its escalation and server-saved counter terms', async () => {
    const { service, auth, create } = await setup();
    await create('e2');
    const decision = { kind: 'Counter' as const, terms: { ...terms, installments: 2 } };
    const first = await service.decisionOptions('e1', decision);
    await expect(service.decide('e2', first.challengeId, auth.assertion(first.options.challenge))).rejects.toThrow('CHALLENGE_INVALID');
    const second = await service.decisionOptions('e1', decision);
    decision.terms.installments = 99;
    expect((await service.decide('e1', second.challengeId, auth.assertion(second.options.challenge))).decision)
      .toEqual({ kind: 'Counter', terms: { ...terms, installments: 2 } });
  });

  it('rejects voice/text claims and a forged StateStore verification capability', async () => {
    const { service, store } = await setup();
    await expect(service.decisionOptions('e1', 'Dana said yes')).rejects.toThrow('INVALID_DECISION');
    await expect(service.decisionOptions('e1', { kind: 'Approve', method: 'passkey', verified: true })).rejects.toThrow('INVALID_DECISION');
    await expect(store.decideEscalation({ method: 'passkey', verified: true } as unknown as VerifiedApproval, 1000)).rejects.toThrow('PASSKEY_REQUIRED');
    expect((await service.get('e1')).status).toBe('pending');
  });

  it('keeps a live call open through the approval window, then expires it and rejects a late valid signature', async () => {
    const { service, auth, store, advance } = await setup();
    const windowMs = approvalWindowMs();
    expect((await store.getEscalation('e1'))?.expiresAt).toBe(1000 + windowMs);
    const { options, challengeId } = await service.decisionOptions('e1', { kind: 'Approve' });
    advance(60_000);
    expect((await service.get('e1')).status).toBe('pending');
    advance(windowMs - 60_000 - 1);
    expect((await service.get('e1')).status).toBe('pending');
    advance(1);
    expect((await service.get('e1')).status).toBe('expired');
    await expect(service.decide('e1', challengeId, auth.assertion(options.challenge))).rejects.toThrow();
    await service.get('e1');
    expect((await store.listAudit()).filter(e => e.action === 'escalation_expired')).toHaveLength(1);
    expect((await store.listAudit()).filter(e => e.action === 'pending_owner')).toHaveLength(0);
  });

  it('records pending_owner when the call ends after the window already expired', async () => {
    const { store, advance } = await setup();
    const windowMs = approvalWindowMs();
    advance(windowMs);
    const at = 1000 + windowMs;
    await store.expireEscalations(at);
    expect((await store.getEscalation('e1'))?.status).toBe('expired');
    expect((await store.listAudit()).filter(e => e.action === 'escalation_expired')).toHaveLength(1);
    expect((await store.listAudit()).filter(e => e.action === 'pending_owner')).toHaveLength(0);
    await store.registerAgent('worker', 'collections', at);
    await store.enqueueTask({ id: 'follow-up', seatId: 'collections', refs: ['1042'], steps: [] });
    const lease = (await store.claimTask('worker', at, 10_000))!;
    await expect(store.transitionInvoice(lease, '1042', 'pending_owner', 'promised', at)).rejects.toThrow('INVALID_INVOICE_TRANSITION');
    await store.expireEscalations(at, 'c1');
    await store.expireEscalations(at, 'c1');
    expect((await store.getEscalation('e1'))?.status).toBe('expired');
    expect((await store.listAudit()).filter(e => e.action === 'escalation_expired')).toHaveLength(1);
    expect((await store.listAudit()).filter(e => e.action === 'pending_owner')).toHaveLength(1);
    await store.transitionInvoice(lease, '1042', 'pending_owner', 'promised', at);
  });

  it('expires a live call when the call ends and still rejects a passkey that is not a valid assertion', async () => {
    const { service, auth, store, advance } = await setup();
    advance(1_000);
    await expect(service.decide('e1', 'missing', {} as AuthenticationResponseJSON)).rejects.toThrow();
    expect((await store.getEscalation('e1'))?.status).toBe('pending');
    const { options, challengeId } = await service.decisionOptions('e1', { kind: 'Approve' });
    await store.expireEscalations(1000 + 1_000, 'c1');
    expect((await service.get('e1')).status).toBe('expired');
    await expect(service.decide('e1', challengeId, auth.assertion(options.challenge))).rejects.toThrow();
    expect((await store.getEscalation('e1'))?.method).toBeUndefined();
    expect((await store.listAudit()).filter(e => e.action === 'pending_owner')).toHaveLength(1);
    expect((await store.listAudit()).filter(e => e.action === 'decide_escalation')).toHaveLength(0);
  });

  it('writes a worker escalation and desk target in one turn without the renderer', async () => {
    const { store } = await setup();
    await store.registerAgent('worker', 'collections', 1000);
    await store.enqueueTask({ id: 'worker-task', seatId: 'collections', refs: ['1042'], steps: [] });
    const lease = (await store.claimTask('worker', 1000, 10000))!;
    const decision = evaluate('collections', { type: 'propose_plan', plan: { installments: 4, firstPaymentPct: 50, totalDays: 30, waiveFees: false, discountPct: 0 } }, { identityConfirmed: true });
    if (decision.kind !== 'ESCALATE') throw new Error('Expected policy escalation');
    const started = performance.now();
    const row = await store.createEscalation(lease, decision, 1000);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(row.expiresAt).toBe(61000);
    expect((await store.getAgent('worker'))?.targetAnchor).toBe('Dana_desk');
  });
});
