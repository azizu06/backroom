import { PaymentService } from '@backroom/orchestrator';
import { FileClaims, NessieClient } from '@backroom/nessie';
import { resolve } from 'node:path';
import { getGatewayStore } from '../gateway/runtime';
import { authorizedPaymentLink } from './authorization';

const root = globalThis as typeof globalThis & { backroomPaymentService?: PaymentService };
/** Install a shared/durable implementation at trusted bootstrap, alongside the gateway/StateStore adapters. */
export function installPaymentService(service: PaymentService) { root.backroomPaymentService = service; }
/** Label from the installed adapter. Does not construct a live client when payments are unconfigured. */
export function installedBankDisclosure() {
  return root.backroomPaymentService?.bankDisclosure();
}
export function installedPaymentRecorded(id: string): boolean {
  return root.backroomPaymentService?.hasRecordedPayment(id) ?? false;
}
export function getPaymentService(): PaymentService {
  if (root.backroomPaymentService) return root.backroomPaymentService;
  if (!process.env.NESSIE_API_KEY || !process.env.NESSIE_ACCOUNT_ID || !process.env.NESSIE_CLAIMS_DIR) {
    throw new Error('PAYMENTS_NOT_CONFIGURED');
  }
  root.backroomPaymentService = new PaymentService({ accountId: process.env.NESSIE_ACCOUNT_ID,
    bank: new NessieClient({ apiKey: process.env.NESSIE_API_KEY, surface: 'nessie_sandbox', claims: new FileClaims(resolve(process.env.NESSIE_CLAIMS_DIR)) }),
    lookup: async id => {
      const call = await getGatewayStore().findPaymentCall?.(id);
      return call ? authorizedPaymentLink(call, id) : undefined;
    } });
  return root.backroomPaymentService;
}
