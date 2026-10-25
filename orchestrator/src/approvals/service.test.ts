import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('signs Dana in to a read-only inbox session that cannot decide a request', async () => {
    const { service, auth, store, create, advance } = await setup();
    await expect((await setup(false)).service.sessionOptions()).rejects.toThrow('CONTROLLER_NOT_REGISTERED');
    const { options, challengeId } = await service.sessionOptions();
    // A sign-in assertion is bound to the session intent: it cannot be spent on a decision.
    await expect(service.decide('e1', challengeId, auth.assertion(options.challenge))).rejects.toThrow('CHALLENGE_INVALID');
    const again = await service.sessionOptions();
    const { token } = await service.signIn(again.challengeId, auth.assertion(again.options.challenge));
    expect(service.hasSession(token)).toBe(true);
    expect(service.hasSession('guess')).toBe(false);
    await expect(service.signIn(again.challengeId, auth.assertion(again.options.challenge))).rejects.toThrow('CHALLENGE_INVALID');
    expect((await store.getEscalation('e1'))?.status).toBe('pending');
    advance(1);
    await create('e2');
    expect((await service.pending(['e1', 'e2', 'missing'])).map(e => e.id)).toEqual(['e2', 'e1']);
    // Live-call rows leave the inbox once the call window expires them.
    advance(approvalWindowMs());
    expect(await service.pending(['e1', 'e2'])).toEqual([]);
    advance(12 * 60 * 60_000);
    expect(service.hasSession(token)).toBe(false);
  });

  describe('controller credential file', () => {
    const config = { origin: 'http://localhost:3020', rpID: 'localhost', enrollmentSecret: 'test-enrollment' };
    async function enrolled() {
      const dir = mkdtempSync(join(tmpdir(), 'backroom-controller-'));
      const credentialFile = join(dir, 'nested', 'controller-credential.json');
      const store = new MemoryStateStore();
      const auth = new TestAuthenticator();
      const first = new ControllerApprovals(store, { ...config, credentialFile });
      const { options, challengeId } = await first.registrationOptions('test-enrollment');
      await first.register('test-enrollment', challengeId, auth.registration(options.challenge));
      const signIn = async (service: ControllerApprovals) => {
        const session = await service.sessionOptions();
        return (await service.signIn(session.challengeId, auth.assertion(session.options.challenge))).token;
      };
      const restart = (overrides: Partial<typeof config> = {}) =>
        new ControllerApprovals(store, { ...config, ...overrides, credentialFile });
      return { store, auth, first, credentialFile, signIn, restart };
    }

    it('lets a restarted service accept the registered passkey without re-enrollment', async () => {
      const { store, auth, first, credentialFile, signIn, restart } = await enrolled();
      const token = await signIn(first);
      const text = readFileSync(credentialFile, 'utf8');
      expect(statSync(credentialFile).mode & 0o777).toBe(0o600);
      expect(text).not.toContain('test-enrollment');
      expect(text).not.toContain(token);

      const second = restart();
      expect(second.isRegistered()).toBe(true);
      expect(second.hasSession(token)).toBe(true);
      await expect(second.registrationOptions('test-enrollment')).rejects.toThrow('CONTROLLER_ALREADY_REGISTERED');
      expect(second.hasSession(await signIn(second))).toBe(true);
      await store.insertInvoice({ id: '1042', kind: 'ar', state: 'in_collection' });
      await store.createCallEscalation({ id: 'e1', taskId: 't1', callId: 'c1', fromAgent: 'collections-1', toHuman: 'Dana',
        seat: 'collections', evidenceRefs: ['audit:1', '1042'], ruleIds: ['MAX_INSTALLMENTS'], invoiceId: '1042', policyVersion: 1,
        quote: { sentenceId: 'NF-005', text: 'At most two installments.' }, amountCents: 495000, principalCents: 480000,
        lateFeeCents: 15000, currency: 'USD', requestedTerms: terms }, Date.now());
      const { options, challengeId } = await second.decisionOptions('e1', { kind: 'Approve' });
      expect(await second.decide('e1', challengeId, auth.assertion(options.challenge)))
        .toMatchObject({ status: 'approved', credentialId: auth.id });

      // Three assertions advanced the sign counter to 3; the next restart still refuses a cloned counter.
      const third = restart();
      const cloned = await third.sessionOptions();
      await expect(third.signIn(cloned.challengeId, auth.assertion(cloned.options.challenge, { counter: 3 }))).rejects.toThrow();
      expect(third.hasSession(await signIn(third))).toBe(true);
    });

    it.each([
      ['a swapped public key', (file: { payload: string }) => {
        const payload = JSON.parse(file.payload);
        payload.credential.publicKey = Buffer.alloc(77, 1).toString('base64url');
        file.payload = JSON.stringify(payload);
      }],
      ['a forged session', (file: { payload: string }) => {
        const payload = JSON.parse(file.payload);
        payload.sessions.push({ hash: 'a'.repeat(43), expiresAt: Number.MAX_SAFE_INTEGER });
        file.payload = JSON.stringify(payload);
      }],
      ['a replaced MAC', (file: { mac: string }) => { file.mac = Buffer.alloc(32).toString('base64url'); }],
      ['unparseable JSON', null],
    ] as const)('rejects a tampered file with %s and requires enrollment again', async (_name, tamper) => {
      const { credentialFile, restart, signIn } = await enrolled();
      if (tamper) {
        const file = JSON.parse(readFileSync(credentialFile, 'utf8'));
        tamper(file);
        writeFileSync(credentialFile, JSON.stringify(file));
      } else writeFileSync(credentialFile, '{ not json');
      const second = restart();
      expect(second.isRegistered()).toBe(false);
      await expect(second.sessionOptions()).rejects.toThrow('CONTROLLER_NOT_REGISTERED');
      await expect(signIn(second)).rejects.toThrow('CONTROLLER_NOT_REGISTERED');
      const next = new TestAuthenticator();
      const { options, challengeId } = await second.registrationOptions('test-enrollment');
      await second.register('test-enrollment', challengeId, next.registration(options.challenge));
      expect(restart().isRegistered()).toBe(true);
    });

    it('does not trust a file written under another enrollment secret or relying party', async () => {
      const { restart } = await enrolled();
      expect(restart({ enrollmentSecret: 'rotated-enrollment' }).isRegistered()).toBe(false);
      expect(restart({ origin: 'http://localhost:3021' }).isRegistered()).toBe(false);
      expect(restart().isRegistered()).toBe(true);
    });
  });

  it('rejects a sign-in assertion without user verification', async () => {
    const { service, auth } = await setup();
    const { options, challengeId } = await service.sessionOptions();
    await expect(service.signIn(challengeId, auth.assertion(options.challenge, { verified: false }))).rejects.toThrow();
  });
});
