/** Shared redacted failure categories across model transports. */
export const ROUTER_FAILURE_KINDS = ['timeout', 'transport', 'http', 'envelope', 'schema', 'confidence'] as const;
export type RouterFailureKind = typeof ROUTER_FAILURE_KINDS[number];
export class ModelFailure extends Error {
  constructor(readonly kind: RouterFailureKind, message: string, readonly status?: number) { super(message); }
}
