import type { GatewayStore, GatewayCall, PaymentLink } from '../gateway/store';
import { authorizedPaymentLink } from './authorization';

function project(call: GatewayCall, link: PaymentLink, now: number) {
  if (!link.shortCode || !link.expiresAt || !authorizedPaymentLink(call, link.id, now)) return;
  return { code: link.shortCode, path: link.path, amountCents: link.amountCents, expiresAt: link.expiresAt };
}
export async function resolvePaymentCode(store: GatewayStore, code: string, now = Date.now()) {
  code = code.toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(code)) return;
  const call = await store.findPaymentCode?.(code);
  const link = call?.links.find(row => row.shortCode === code);
  return call && link ? project(call, link, now) : undefined;
}
export async function activePaymentDelivery(store: GatewayStore, now = Date.now()) {
  const call = await store.activePaymentCall?.();
  const link = call?.links.at(-1);
  return call && link ? project(call, link, now) : undefined;
}
/** No localhost or voice relay prefix may escape into the caller's link. */
export function paymentPublicOrigin() {
  const url = new URL(process.env.DEMO_PUBLIC_URL || '');
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password
    || /^(localhost|127\.|\[::1\])/.test(url.hostname)) throw new Error('PUBLIC_HTTPS_ORIGIN_REQUIRED');
  return url.origin;
}
