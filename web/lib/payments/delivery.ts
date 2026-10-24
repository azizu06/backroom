import type { GatewayStore, GatewayCall, PaymentLink } from '../gateway/store';
import { authorizedPaymentLink } from './authorization';

function project(call: GatewayCall, link: PaymentLink, now: number) {
  if (!link.shortCode || !link.expiresAt || !authorizedPaymentLink(call, link.id, now)) return;
  return { code: link.shortCode, amountCents: link.amountCents, expiresAt: link.expiresAt };
}
export async function resolvePaymentCode(store: GatewayStore, code: string, now = Date.now()) {
  code = code.toUpperCase();
  if (!/^[A-F0-9]{10}$/.test(code)) return;
  const call = await store.findPaymentCode?.(code);
  const link = call?.links.find(row => row.shortCode === code);
  const delivery = call && link ? project(call, link, now) : undefined;
  return delivery && link ? { ...delivery, path: link.path } : undefined;
}
export async function activePaymentDelivery(store: GatewayStore, now = Date.now()) {
  const call = await store.activePaymentCall?.();
  const link = call?.links.at(-1);
  return call && link ? project(call, link, now) : undefined;
}
const LOOPBACK_HOST = /^(localhost|127\.|\[::1\])/;

/** No localhost or voice relay prefix may escape into the caller's link, except an explicit offline rehearsal. */
export function paymentPublicOrigin(): { origin: string; localOnly: boolean } {
  const url = new URL(process.env.DEMO_PUBLIC_URL || '');
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('PUBLIC_HTTPS_ORIGIN_REQUIRED');
  const loopback = LOOPBACK_HOST.test(url.hostname);
  // DEMO_TUNNEL=0 is the supervisor's offline mark. Anything else keeps the public HTTPS rule.
  if (process.env.DEMO_TUNNEL === '0' && loopback && (url.protocol === 'http:' || url.protocol === 'https:')) {
    return { origin: url.origin, localOnly: true };
  }
  if (url.protocol !== 'https:' || loopback) throw new Error('PUBLIC_HTTPS_ORIGIN_REQUIRED');
  return { origin: url.origin, localOnly: false };
}
