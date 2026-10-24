import { getGatewayStore } from '../../../lib/gateway/runtime';
import { resolvePaymentCode, paymentPublicOrigin } from '../../../lib/payments/delivery';
export const runtime = 'nodejs';
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  const link = await resolvePaymentCode(getGatewayStore(), (await params).code);
  if (!link) return new Response('This payment code is unavailable or expired.', { status: 404, headers });
  try { return new Response(null, { status: 303, headers: { ...headers, Location: `${paymentPublicOrigin()}${link.path}` } }); }
  catch { return new Response('Payment host unavailable.', { status: 503, headers }); }
}
