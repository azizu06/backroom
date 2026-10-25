import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

/** Test-only software authenticator, exercising the real verifier with P-256 signatures. */
export class TestAuthenticator {
  private keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  private rawId = randomBytes(32);
  private counter = 0;
  readonly id = this.rawId.toString('base64url');
  private data(challenge: string, type: string, origin = 'http://localhost:3020') {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }
  private authData(flags: number, rpID = 'localhost', counter = this.counter) {
    const count = Buffer.alloc(4); count.writeUInt32BE(counter);
    return Buffer.concat([createHash('sha256').update(rpID).digest(), Buffer.from([flags]), count]);
  }
  registration(challenge: string): RegistrationResponseJSON {
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([
      [1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')],
    ]));
    const size = Buffer.alloc(2); size.writeUInt16BE(this.rawId.length);
    const authData = Buffer.concat([this.authData(0x45), Buffer.alloc(16), size, this.rawId, cose]);
    const attestation = isoCBOR.encode(new Map<string, string | Uint8Array | Map<string, string>>([
      ['fmt', 'none'], ['authData', authData], ['attStmt', new Map()],
    ]));
    return { id: this.id, rawId: this.id, type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: this.data(challenge, 'webauthn.create').toString('base64url'),
        attestationObject: Buffer.from(attestation).toString('base64url'), transports: ['internal'] } };
  }
  /** `counter` signs with that value (a cloned authenticator) without advancing this one. */
  assertion(challenge: string, options: { origin?: string; rpID?: string; verified?: boolean; counter?: number } = {}): AuthenticationResponseJSON {
    const client = this.data(challenge, 'webauthn.get', options.origin);
    const auth = this.authData(options.verified === false ? 0x01 : 0x05, options.rpID, options.counter ?? ++this.counter);
    const signature = sign('sha256', Buffer.concat([auth, createHash('sha256').update(client).digest()]), this.keys.privateKey);
    return { id: this.id, rawId: this.id, type: 'public-key', clientExtensionResults: {}, response: {
      clientDataJSON: client.toString('base64url'), authenticatorData: auth.toString('base64url'),
      signature: signature.toString('base64url'), userHandle: Buffer.from('backroom-controller-dana').toString('base64url'),
    } };
  }
}
