import { timingSafeEqual, randomUUID, randomBytes } from 'node:crypto';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON, type WebAuthnCredential,
} from '@simplewebauthn/server';
import type { StateStore } from '../store';
import { parseControllerDecision, type ControllerDecision } from './types';
import { issueVerifiedApproval } from './verified';

export interface ApprovalConfig {
  origin: string; rpID: string; enrollmentSecret: string; human?: string;
}
interface Challenge {
  challenge: string; expiresAt: number;
  intent: { kind: 'register' } | { kind: 'session' } | { kind: 'decide'; id: string; decision: ControllerDecision };
}
const SESSION_MS = 12 * 60 * 60_000;
/** Single-process controller service. Public credentials only; no biometric/private key leaves the authenticator.
 * Replace together with StateStore for durable deployments. Never instantiate once per request.
 */
export class ControllerApprovals {
  private credential?: WebAuthnCredential;
  private challenges = new Map<string, Challenge>();
  /** Sign-in token -> expiry. A session only lists pending requests; it never decides one. */
  private sessions = new Map<string, number>();
  private human: string;
  constructor(private store: StateStore, private config: ApprovalConfig, private now = Date.now) {
    const origin = new URL(config.origin);
    if (origin.origin !== config.origin || (origin.protocol !== 'https:' && origin.hostname !== 'localhost') ||
        (origin.hostname !== config.rpID && !origin.hostname.endsWith(`.${config.rpID}`))) throw new Error('INVALID_WEBAUTHN_ORIGIN');
    this.human = config.human ?? 'Dana';
  }
  isRegistered() { return !!this.credential; }
  private authorizeEnrollment(secret: unknown) {
    if (!this.config.enrollmentSecret || typeof secret !== 'string') throw new Error('ENROLLMENT_UNAUTHORIZED');
    const a = Buffer.from(secret), b = Buffer.from(this.config.enrollmentSecret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('ENROLLMENT_UNAUTHORIZED');
    if (this.credential) throw new Error('CONTROLLER_ALREADY_REGISTERED');
  }
  private save(challenge: string, intent: Challenge['intent']) {
    for (const [id, item] of this.challenges) if (item.expiresAt <= this.now()) this.challenges.delete(id);
    if (this.challenges.size >= 100) throw new Error('TOO_MANY_CHALLENGES');
    const challengeId = randomUUID();
    this.challenges.set(challengeId, { challenge, intent: structuredClone(intent), expiresAt: this.now() + 60_000 });
    return challengeId;
  }
  private take(challengeId: string, kind: Challenge['intent']['kind']) {
    const item = this.challenges.get(challengeId);
    this.challenges.delete(challengeId); // Consume before awaiting verification: racing/replayed assertions lose.
    if (!item || item.expiresAt <= this.now() || item.intent.kind !== kind) throw new Error('CHALLENGE_INVALID');
    return item;
  }
  async registrationOptions(secret: unknown) {
    this.authorizeEnrollment(secret);
    const options = await generateRegistrationOptions({ rpName: 'Backroom · Dana', rpID: this.config.rpID,
      userID: new TextEncoder().encode('backroom-controller-dana'), userName: this.human,
      attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' } });
    return { options, challengeId: this.save(options.challenge, { kind: 'register' }) };
  }
  async register(secret: unknown, challengeId: string, response: RegistrationResponseJSON) {
    this.authorizeEnrollment(secret);
    const item = this.take(challengeId, 'register');
    const result = await verifyRegistrationResponse({ response, expectedChallenge: item.challenge,
      expectedOrigin: this.config.origin, expectedRPID: this.config.rpID, requireUserVerification: true });
    if (!result.verified || !result.registrationInfo) throw new Error('PASSKEY_INVALID');
    // Recheck after async crypto: a parallel enrollment must not replace Dana.
    this.authorizeEnrollment(secret);
    this.credential = structuredClone(result.registrationInfo.credential);
    this.challenges.clear();
    return { registered: true };
  }
  async get(id: string) {
    await this.store.expireEscalations(this.now());
    const escalation = await this.store.getEscalation(id);
    if (!escalation || escalation.toHuman !== this.human) throw new Error('ESCALATION_NOT_FOUND');
    return escalation;
  }
  async decisionOptions(id: string, raw: unknown) {
    if (!this.credential) throw new Error('CONTROLLER_NOT_REGISTERED');
    const escalation = await this.get(id);
    if (escalation.status !== 'pending') throw new Error('ESCALATION_CLOSED');
    const decision = parseControllerDecision(raw);
    const options = await generateAuthenticationOptions({ rpID: this.config.rpID, userVerification: 'required',
      allowCredentials: [{ id: this.credential.id, transports: this.credential.transports }] });
    return { options, challengeId: this.save(options.challenge, { kind: 'decide', id, decision }) };
  }
  async decide(id: string, challengeId: string, response: AuthenticationResponseJSON) {
    const item = this.take(challengeId, 'decide');
    if (item.intent.kind !== 'decide' || item.intent.id !== id) throw new Error('CHALLENGE_INVALID');
    const credential = this.credential;
    if (!credential || response?.id !== credential.id) throw new Error('PASSKEY_INVALID');
    const result = await verifyAuthenticationResponse({ response, credential,
      expectedChallenge: item.challenge, expectedOrigin: this.config.origin,
      expectedRPID: this.config.rpID, requireUserVerification: true });
    if (!result.verified) throw new Error('PASSKEY_INVALID');
    const escalation = await this.store.decideEscalation(issueVerifiedApproval({ id, human: this.human,
      decision: item.intent.decision, credentialId: credential.id }), this.now());
    credential.counter = Math.max(credential.counter, result.authenticationInfo.newCounter);
    return escalation;
  }
  async sessionOptions() {
    if (!this.credential) throw new Error('CONTROLLER_NOT_REGISTERED');
    const options = await generateAuthenticationOptions({ rpID: this.config.rpID, userVerification: 'required',
      allowCredentials: [{ id: this.credential.id, transports: this.credential.transports }] });
    return { options, challengeId: this.save(options.challenge, { kind: 'session' }) };
  }
  /** Passkey sign-in for the live controller inbox. Each decision still needs its own bound assertion. */
  async signIn(challengeId: string, response: AuthenticationResponseJSON) {
    const item = this.take(challengeId, 'session');
    const credential = this.credential;
    if (!credential || response?.id !== credential.id) throw new Error('PASSKEY_INVALID');
    const result = await verifyAuthenticationResponse({ response, credential,
      expectedChallenge: item.challenge, expectedOrigin: this.config.origin,
      expectedRPID: this.config.rpID, requireUserVerification: true });
    if (!result.verified) throw new Error('PASSKEY_INVALID');
    credential.counter = Math.max(credential.counter, result.authenticationInfo.newCounter);
    for (const [token, expiresAt] of this.sessions) if (expiresAt <= this.now()) this.sessions.delete(token);
    if (this.sessions.size >= 20) this.sessions.delete(this.sessions.keys().next().value!);
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, this.now() + SESSION_MS);
    return { token, maxAgeSeconds: SESSION_MS / 1000 };
  }
  hasSession(token: unknown) {
    return typeof token === 'string' && (this.sessions.get(token) ?? 0) > this.now();
  }
  /** Pending requests for this controller among `ids`, newest first. Expiry runs first, as in `get`. */
  async pending(ids: readonly string[]) {
    await this.store.expireEscalations(this.now());
    const rows = await Promise.all(ids.map(id => this.store.getEscalation(id)));
    return rows.filter((row): row is NonNullable<typeof row> => !!row && row.toHuman === this.human && row.status === 'pending')
      .sort((a, b) => b.createdAt - a.createdAt);
  }
}
