import QRCode from 'qrcode';
import { getGatewayStore } from '../../../../lib/gateway/runtime';
import { activePaymentDelivery, paymentPublicOrigin } from '../../../../lib/payments/delivery';
export const runtime = 'nodejs';
export async function GET() {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  try {
    const link = await activePaymentDelivery(getGatewayStore());
    if (!link) return Response.json({ active: null }, { headers });
    const published = paymentPublicOrigin();
    const url = `${published.origin}/p/${link.code}`;
    return Response.json({ active: { ...link, url, ...(published.localOnly ? { localOnly: true } : {}), qr: await QRCode.toDataURL(url, { width: 256, margin: 4, errorCorrectionLevel: 'M' }) } }, { headers });
  } catch { return Response.json({ error: 'PAYMENT_DELIVERY_UNAVAILABLE' }, { status: 503, headers }); }
}
