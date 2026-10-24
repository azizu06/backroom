import 'server-only';
import { createCostSummaryHandler } from '@backroom/orchestrator';

const json = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Read-only, in-process proxy. Never expose the gateway bearer to the browser. */
export function createAgentsCostProxy(options: {
  origin: () => string | undefined;
  secret: () => string | undefined;
}) {
  const handle = createCostSummaryHandler({ secret: options.secret });
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const origin = options.origin();
    const sentOrigin = request.headers.get('origin');
    // Same-origin browser GETs omit Origin, as with the attack-demo proxy.
    if (!origin || (sentOrigin !== null && sentOrigin !== origin)) {
      return json({ error: 'ORIGIN_REJECTED' }, 403);
    }
    const secret = options.secret();
    if (!secret) return json({ error: 'GATEWAY_NOT_CONFIGURED' }, 503);
    const query = new URL(request.url).searchParams;
    // Reject unknown keys instead of silently dropping a caller's invalid filter.
    if ([...query.keys()].some(key => !['source', 'runId', 'invoiceId'].includes(key))) {
      return json({ error: 'INVALID_QUERY' }, 400);
    }
    const upstream = new URL('http://agents.internal/api/costs');
    for (const [key, value] of query) upstream.searchParams.append(key, value);
    return handle(new Request(upstream, {
      method: 'GET', headers: { Authorization: `Bearer ${secret}` },
    }));
  };
}
