/**
 * "Payment link ready" toast for the office: which `/api/pay/active` delivery to announce. View only: it never
 * creates, approves or pays a link; the panel it opens reads the same public projection.
 */
export interface ActivePaymentLink { readonly code: string; readonly expiresAt: number }

/** The link to announce: a live delivery the viewer has not been told about yet, else null. */
export function paymentLinkToAnnounce(active: ActivePaymentLink | null | undefined, announced: ReadonlySet<string>, now: number): ActivePaymentLink | null {
  if (!active || typeof active.code !== 'string' || !active.code || !(active.expiresAt > now)) return null;
  return announced.has(active.code) ? null : active;
}

/** How often the office checks for a new call payment link. */
export const PAYMENT_TOAST_POLL_MS = 3000;
