import { paymentLinkMemo, type PaymentRecord, type PaymentService, type StateStore } from '@backroom/orchestrator';

/** Link identity the demo host can see. Installment 1 matches `authorizedPaymentLink`. */
export interface DemoRecoveryLink {
  id: string;
  invoiceId: string;
  installment: number;
}

/**
 * The bank memo names the pay link, so a deposit an older link left in the sandbox (for example before a
 * company reset) has a different memo and is simply ignored. This guard only refuses a link minted in this
 * boot whose own memo was already in the feed. Recover never deposits, writes receipts, or moves invoices.
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
    try { memo = paymentLinkMemo(link); }
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
): Promise<PaymentRecord[]> {
  try { return (await service.recover(linkIds, state)).restored; }
  catch (error) { console.error('demo payment recovery failed', error); return []; }
}
