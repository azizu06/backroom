import type { Effects } from '../effects';
import type { PayablesClient } from './types';

/** Bridge the exported worker effect interface; adapters must return an actual
 * completed/pending receipt. FakeEffects' generic success is not a paid invoice.
 * The deposit-only Nessie client is NOT an AP debit: leave this unset until the
 * integration owner supplies a debit adapter with durable idempotency.
 */
export function nessiePayables(effects: Pick<Effects, 'nessie'>): PayablesClient {
  return {
    async payInvoice(input) {
      const result = await effects.nessie({ idempotencyKey: input.idempotencyKey, input: { ...input } });
      if (result.simulated === true || typeof result.externalId !== 'string' || !result.externalId ||
          (result.status !== 'completed' && result.status !== 'pending')) throw new Error('NESSIE_PAYMENT_UNCONFIRMED');
      return { id: result.externalId, status: result.status };
    },
  };
}
