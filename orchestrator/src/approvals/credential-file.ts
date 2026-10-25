import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WebAuthnCredential } from '@simplewebauthn/server';

/** What survives a host restart: Dana's PUBLIC credential and sign-in token hashes. */
export interface ControllerRecord {
  credential: WebAuthnCredential;
  /** sha256(token) -> expiry. Raw session tokens never reach disk. */
  sessions: Map<string, number>;
}
interface Binding { origin: string; rpID: string; enrollmentSecret: string }
interface StoredPayload {
  origin: string; rpID: string;
  credential: { id: string; publicKey: string; counter: number; transports?: string[] };
  sessions: { hash: string; expiresAt: number }[];
}

/** Keyed by the private enrollment secret, which itself is never written. A file edited, swapped
 * in for another relying party, or left from a rotated secret fails this MAC and is never trusted. */
function mac(binding: Binding, payload: string) {
  const key = createHmac('sha256', binding.enrollmentSecret).update('backroom-controller-credential-file-v1').digest();
  return createHmac('sha256', key).update(payload).digest();
}

/** Returns undefined for a missing, unreadable, tampered or foreign file: Dana must enroll again. */
export function loadControllerRecord(path: string, binding: Binding, now: number): ControllerRecord | undefined {
  try {
    let text: string;
    try { text = readFileSync(path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    const file = JSON.parse(text) as { version?: unknown; payload?: unknown; mac?: unknown };
    if (file.version !== 1 || typeof file.payload !== 'string' || typeof file.mac !== 'string') throw new Error('shape');
    const expected = mac(binding, file.payload), actual = Buffer.from(file.mac, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('mac');
    const payload = JSON.parse(file.payload) as StoredPayload;
    if (payload.origin !== binding.origin || payload.rpID !== binding.rpID) throw new Error('binding');
    const { id, publicKey, counter, transports } = payload.credential;
    return {
      credential: { id, publicKey: new Uint8Array(Buffer.from(publicKey, 'base64url')), counter, ...(transports && { transports }) },
      sessions: new Map(payload.sessions.filter(s => s.expiresAt > now).map(s => [s.hash, s.expiresAt])),
    };
  } catch {
    console.warn('CONTROLLER_CREDENTIAL_FILE_REJECTED: enroll Dana again to replace it');
    return undefined;
  }
}

/** Atomic (temp + rename), mode 0600 in a 0700 directory. */
export function saveControllerRecord(path: string, binding: Binding, record: ControllerRecord) {
  const { id, publicKey, counter, transports } = record.credential;
  const payload = JSON.stringify({ origin: binding.origin, rpID: binding.rpID,
    credential: { id, publicKey: Buffer.from(publicKey).toString('base64url'), counter, ...(transports && { transports }) },
    sessions: [...record.sessions].map(([hash, expiresAt]) => ({ hash, expiresAt })) } satisfies StoredPayload);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, payload, mac: mac(binding, payload).toString('base64url') }), { mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) { rmSync(temporary, { force: true }); throw error; }
}
