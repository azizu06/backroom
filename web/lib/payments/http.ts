import { PaymentError, type PaymentService } from '@backroom/orchestrator';
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
/** Opaque linkId is a payment capability. No amount, invoice, installment, card, or model text accepted. */
export function paymentHttp(service: () => PaymentService) {
  return async (request: Request, linkId: string): Promise<Response> => {
    try {
      if (!/^[a-zA-Z0-9-]{1,128}$/.test(linkId)) throw new PaymentError('PAYMENT_LINK_NOT_FOUND', 404);
      if (request.method === 'POST') {
        if (!sameOrigin(request)) return Response.json({ error: 'ORIGIN_REQUIRED' }, { status: 403, headers });
        const body: unknown = await request.json().catch(() => null);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) {
          return Response.json({ error: 'EMPTY_BODY_REQUIRED' }, { status: 400, headers });
        }
        await service().pay(linkId);
      } else if (request.method !== 'GET') return new Response(null, { status: 405, headers });
      return Response.json(await service().view(linkId), { headers });
    } catch (error) {
      const known = error instanceof PaymentError || (error instanceof Error && error.name === 'PaymentError'
        && 'code' in error && 'status' in error) ? error as PaymentError : undefined;
      return Response.json({ error: known?.code ?? 'PAYMENT_SERVICE_UNAVAILABLE' },
        { status: known?.status ?? 503, headers });
    }
  };
}

// Next may normalize request.url to localhost behind its dev/reverse proxy. Host is
// the browser-visible authority; browsers cannot forge Host in a cross-origin fetch.
function sameOrigin(request: Request) {
  try {
    const origin = new URL(request.headers.get('origin') ?? '');
    return origin.host === (request.headers.get('host') ?? new URL(request.url).host)
      && origin.protocol === new URL(request.url).protocol;
  } catch { return false; }
}
