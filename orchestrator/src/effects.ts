import type { EffectKind } from './store';

export type EffectResult = Record<string, unknown>;
export interface EffectRequest {
  input: Record<string, unknown>; signal?: AbortSignal; idempotencyKey?: string;
}
/** Real payment adapters MUST durably deduplicate by key (including ambiguous timeouts),
 * reject key reuse with different inputs, and return the original receipt on replay.
 * dial resolves when the call ends; early call IDs need a webhook-backed completion wait.
 */
export interface Effects {
  dial(request: EffectRequest): Promise<EffectResult>;
  crs(request: EffectRequest): Promise<EffectResult>;
  apify(request: EffectRequest): Promise<EffectResult>;
  nessie(request: EffectRequest): Promise<EffectResult>;
}
export class FakeEffects implements Effects {
  readonly calls: { kind: EffectKind; input: Record<string, unknown>; idempotencyKey?: string }[] = [];
  beforeEffect?: () => Promise<void>;
  private payments = new Map<string, { input: string; result: Promise<EffectResult> }>();
  dial(request: EffectRequest) { return this.invoke('dial', request); }
  crs(request: EffectRequest) { return this.invoke('crs', request); }
  apify(request: EffectRequest) { return this.invoke('apify', request); }
  nessie(request: EffectRequest): Promise<EffectResult> {
    if (!request.idempotencyKey) return Promise.reject(new Error('PAYMENT_KEY_REQUIRED'));
    const input = JSON.stringify(request.input);
    const prior = this.payments.get(request.idempotencyKey);
    if (prior) return prior.input === input ? prior.result : Promise.reject(new Error('PAYMENT_KEY_CONFLICT'));
    const result = this.invoke('nessie', request);
    this.payments.set(request.idempotencyKey, { input, result });
    return result;
  }
  private async invoke(kind: EffectKind, request: EffectRequest) {
    request.signal?.throwIfAborted();
    await this.beforeEffect?.();
    this.calls.push({ kind, input: structuredClone(request.input), idempotencyKey: request.idempotencyKey });
    return { externalId: `fake:${kind}:${this.calls.length}`, simulated: true };
  }
}
