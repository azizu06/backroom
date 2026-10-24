import { createAskWhyHandler, verifyChain, type AuditEntry, type StateStore,
  type WhyAuditEntry, type WhyOptions } from '@backroom/orchestrator';
import { operatorSignedIn } from '../operator/sign-in';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

/** Read permission only, from the shared operator sign-in (`/api/session`). This cookie cannot authorize an approval or a tool. */
export function createAuditHTTP(options: {
  store: () => StateStore; secret: () => string | undefined; origin: () => string | undefined;
  /** Host office `http://127.0.0.1:<DEMO_PORT>`, accepted beside `origin`. No other localhost. */
  loopbackOrigin?: () => string | undefined;
  whyOptions?: WhyOptions; now?: () => number;
}) {
  const now = options.now ?? Date.now;
  return async (action: string, request: Request): Promise<Response> => {
    const secret = options.secret(), origin = options.origin();
    if (!secret || !origin) return json({ error: 'Audit access is not configured.' }, 503);
    const requestOrigin = request.headers.get('origin');
    const loopback = options.loopbackOrigin?.();
    if (request.method === 'POST' && requestOrigin !== origin && requestOrigin !== loopback) return json({ error: 'Origin rejected.' }, 403);
    if (!operatorSignedIn(request, secret, now())) return json({ error: 'Sign in with the operator code to open the audit wall.' }, 401);
    try {
      const store = options.store();
      if (action === 'entries' && request.method === 'GET') {
        // Verify exactly the complete snapshot sent to the wall, including old rows.
        const entries = await store.listAudit();
        return json({ entries, chain: verifyChain(entries), measuredAt: new Date(now()).toISOString() });
      }
      if (action === 'why' && request.method === 'POST') {
        const entries = await store.listAudit();
        const chain = verifyChain(entries);
        if (!chain.valid) return json({ error: `Cannot explain an untrusted chain. First broken sequence: ${chain.firstBrokenSeq}.` }, 409);
        const handler = createAskWhyHandler(async () => projectWhy(entries), { ...options.whyOptions, stateStore: store });
        const response = await handler(request);
        response.headers.set('Cache-Control', 'no-store');
        return response;
      }
      return json({ error: 'Method or route not allowed.' }, 405);
    } catch {
      return json({ error: 'Audit records are unavailable. Try again.' }, 503);
    }
  };
}

/** Only recorded outcomes; raw inputs are never spread into model context. */
function projectWhy(entries: AuditEntry[]): WhyAuditEntry[] {
  return entries.flatMap(entry => {
    const outcome = entry.decision === 'ALLOW' ? 'allowed' : entry.decision === 'DENY' ? 'denied'
      : entry.decision === 'ESCALATE' ? 'escalated' : undefined;
    if (!outcome) return [];
    const inputs: WhyAuditEntry['inputs'] = {};
    const source = entry.inputs ?? {};
    for (const key of ['invoiceId', 'relatedInvoiceId', 'vendorId', 'senderDomain', 'vendorDomain'] as const) {
      if (typeof source[key] === 'string') inputs[key] = source[key];
    }
    for (const key of ['amountDelta', 'requestedInstallments', 'maxInstallments'] as const) {
      if (typeof source[key] === 'number') inputs[key] = source[key];
    }
    if (typeof source.bankChanged === 'boolean') inputs.bankChanged = source.bankChanged;
    return [{ id: entry.id, actor: entry.actor, seat: entry.seat, action: entry.action, outcome,
      policyVersion: entry.policyVersion, ruleIds: entry.ruleIds, evidenceRefs: entry.refs, inputs }];
  });
}
