import type { Effects } from '../effects';
import type { PayablesClient } from './types';
import { masterPayment, type VendorMaster } from '../payment-boundary';
import type { NessieClient } from '@backroom/nessie';

/** Bridge the exported worker effect interface; adapters must return an actual
 * completed/pending receipt. FakeEffects' generic success is not a paid invoice.
 * This generic effect bridge remains separate from the direct sandbox debit
 * adapter below; simulated effect success is never a paid invoice.
 * Called under PayablesSeat's vendor lock, with the same server-owned repository.
 */
export function nessiePayables(effects: Pick<Effects, 'nessie'>, master: VendorMaster): PayablesClient {
  return {
    async payInvoice(input) {
      const payment = await masterPayment({ ...input }, master);
      const result = await effects.nessie({ idempotencyKey: input.idempotencyKey, input: payment });
      if (result.simulated === true || typeof result.externalId !== 'string' || !result.externalId ||
          (result.status !== 'completed' && result.status !== 'pending')) throw new Error('NESSIE_PAYMENT_UNCONFIRMED');
      return { id: result.externalId, status: result.status };
    },
  };
}

/** Direct Capital One Nessie sandbox AP adapter. The source account is fixed by
 * server configuration; the invoice, amount and approved payee reach this only
 * after PayablesSeat has rerun policy and the vendor-master boundary. */
export function nessieDebitPayables(
  bank: Pick<NessieClient, 'withdraw' | 'reconcileWithdrawal'>,
  accountId: string,
): PayablesClient {
  if (!accountId.trim()) throw new Error('NESSIE_ACCOUNT_ID_REQUIRED');
  return {
    async payInvoice(input) {
      if (input.sourceAccount !== 'operating' || !input.destinationAccountId ||
          input.idempotencyKey !== `ap:${encodeURIComponent(input.vendorId)}:${encodeURIComponent(input.invoiceId)}`) {
        throw new Error('NESSIE_DEBIT_BOUNDARY_REJECTED');
      }
      const request = { accountId, vendorId: input.vendorId, invoiceId: input.invoiceId, amountCents: input.amountCents };
      const debit = await bank.withdraw(request);
      if (!debit?._id) throw new Error('NESSIE_DEBIT_ID_MISSING');
      const reconciliation = await bank.reconcileWithdrawal(request, debit._id);
      return { id: debit._id, status: debit.status === 'completed' ? 'completed' : 'pending', reconciliation };
    },
  };
}
