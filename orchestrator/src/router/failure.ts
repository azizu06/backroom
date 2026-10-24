/** Shared redacted failure categories across model transports. */
export type RouterFailureKind = 'timeout' | 'transport' | 'http' | 'envelope' | 'schema' | 'confidence';
export class ModelFailure extends Error {
  constructor(readonly kind: RouterFailureKind, message: string, readonly status?: number) { super(message); }
}
