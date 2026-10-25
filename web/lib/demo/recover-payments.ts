import { paymentMemo } from '@backroom/nessie';
import type { PaymentService, StateStore } from '@backroom/orchestrator';

/** Link identity the demo host can see. Installment 1 matches `authorizedPaymentLink`. */
export interface DemoRecoveryLink {
  id: string;
  invoiceId: string;
  installment: number;
}

/**
 * The bank memo and the reducer receipt are `invoice + installment`, not the pay-link id.
 * A link minted in this boot must not inherit a deposit that already existed for that memo.
 * Recover itself never deposits, writes receipts, or moves invoices; skipping is local.
 */
export function selectRecoverableLinkIds(
  links: readonly DemoRecoveryLink[],
  depositsBeforeTheseLinks: readonly { description: string }[],
  mintedLinkIds: readonly string[],
): { ids: string[]; skipped: { linkId: string; reason: string }[] } {
  const minted = new Set(mintedLinkIds);
  const priorMemos = new Set(depositsBeforeTheseLinks.map(row => row.description));
  const ids: string[] = [];
  const skipped: { linkId: string; reason: string }[] = [];
  for (const link of links) {
    let memo: string;
    try { memo = paymentMemo(link); }
    catch { skipped.push({ linkId: link.id, reason: 'UNREADABLE_LINK' }); continue; }
    if (minted.has(link.id) && priorMemos.has(memo)) {
      skipped.push({ linkId: link.id, reason: 'NEW_LINK_EXISTING_DEPOSIT' });
      continue;
    }
    ids.push(link.id);
  }
  return { ids, skipped };
}

/** A feed or store failure must not stop the demo host from booting. */
export async function recoverDemoPayments(
  service: PaymentService,
  linkIds: readonly string[],
  state: Pick<StateStore, 'getPayment'>,
): Promise<void> {
  try { await service.recover(linkIds, state); }
  catch (error) { console.error('demo payment recovery failed', error); }
}
