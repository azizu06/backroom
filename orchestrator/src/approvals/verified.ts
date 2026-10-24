import type { ControllerDecision } from './types';

// Server-internal capability. It cannot be minted by JSON, voice, or a claimed
// `verified: true`. StateStore consumes it exactly once, before any mutation.
type Grant = { id: string; human: string; decision: ControllerDecision; credentialId: string };
// Next can bundle the verifier and the installed store into separate route chunks.
// A process-local registry preserves the capability boundary across those chunks.
const registry = Symbol.for('backroom.verified-approvals');
const root = globalThis as typeof globalThis & { [registry]?: WeakMap<object, Grant> };
const grants = root[registry] ??= new WeakMap<object, Grant>();
export interface VerifiedApproval { readonly __verifiedApproval: unique symbol }
export function issueVerifiedApproval(value: { id: string; human: string; decision: ControllerDecision; credentialId: string }): VerifiedApproval {
  const grant = Object.freeze({}) as VerifiedApproval;
  grants.set(grant, structuredClone(value));
  return grant;
}
export function consumeVerifiedApproval(grant: VerifiedApproval) {
  const value = grant && grants.get(grant);
  if (!value) throw new Error('PASSKEY_REQUIRED');
  grants.delete(grant);
  return value;
}
