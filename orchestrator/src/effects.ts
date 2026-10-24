import type { EffectKind } from './store';
import { masterPayment, type VendorMaster } from './payment-boundary';
import { MemoryFinanceRepository } from './payables/repository';

export type EffectResult = Record<string, unknown>;
export interface EffectRequest {
  input: Record<string, unknown>; signal?: AbortSignal; idempotencyKey?: string;
}
/** Real payment adapters MUST durably deduplicate by key (including ambiguous timeouts),
 * reject key reuse with different inputs, and return the original receipt on replay.
 * Inside the AP effect boundary, resolve/validate the destination against the trusted
 * approved master, reject recipient overrides, and forward only canonical bank fields.
 * nessiePayables is the supplied master-validating bridge for real AP adapters.
 * dial resolves when the call ends; early call IDs need a webhook-backed completion wait.
 */
export interface Effects {
  dial(request: EffectRequest): Promise<EffectResult>;
  crs(request: EffectRequest): Promise<EffectResult>;
  apify(request: EffectRequest): Promise<EffectResult>;
  nessie(request: EffectRequest): Promise<EffectResult>;
}
export class FakeEffects implements Effects {
  constructor(private readonly master: VendorMaster = new MemoryFinanceRepository()) {}
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
    const result = this.pay({ ...request, input: structuredClone(request.input) });
    this.payments.set(request.idempotencyKey, { input, result });
    return result;
  }
  private async pay(request: EffectRequest) {
    request.signal?.throwIfAborted();
    await this.beforeEffect?.();
    const vendorId = (request.input.invoice as { vendorId?: unknown } | undefined)?.vendorId ?? request.input.vendorId;
    return this.master.withVendorLock(`vendor:${String(vendorId)}`, async () => {
      const input = await masterPayment(request.input, this.master);
      request.signal?.throwIfAborted();
      this.calls.push({ kind: 'nessie', input, idempotencyKey: request.idempotencyKey });
      return { externalId: `fake:nessie:${this.calls.length}`, simulated: true };
    });
  }
  private async invoke(kind: EffectKind, request: EffectRequest) {
    request.signal?.throwIfAborted();
    await this.beforeEffect?.();
    this.calls.push({ kind, input: structuredClone(request.input), idempotencyKey: request.idempotencyKey });
    return { externalId: `fake:${kind}:${this.calls.length}`, simulated: true };
  }
}
