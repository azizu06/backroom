import type { ControllerApprovals } from '@backroom/orchestrator';

type JSONBody = Record<string, unknown>;
function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
function exact(body: JSONBody, keys: string[]) {
  if (Object.keys(body).sort().join(',') !== keys.sort().join(',')) throw new Error('INVALID_REQUEST');
}
/** Origin is deployment config, never derived from Host/X-Forwarded-Host. */
export function createApprovalHTTP(service: () => ControllerApprovals, origin: () => string | undefined) {
  return async (scope: 'controller' | 'approval', id: string, action: string, request: Request) => {
    try {
      if (request.method === 'GET') {
        if (action !== 'view') return json({ error: 'NOT_FOUND' }, 404);
        const approvals = service();
        return json(scope === 'controller' ? { registered: approvals.isRegistered() }
          : { escalation: await approvals.get(id), registered: approvals.isRegistered() });
      }
      if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
      if (!origin() || request.headers.get('origin') !== origin()) return json({ error: 'ORIGIN_REJECTED' }, 403);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON_REQUIRED' }, 415);
      if (Number(request.headers.get('content-length') ?? 0) > 65536) return json({ error: 'REQUEST_TOO_LARGE' }, 413);
      const raw = await request.text();
      if (raw.length > 65536) return json({ error: 'REQUEST_TOO_LARGE' }, 413);
      const body: JSONBody = JSON.parse(raw);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_REQUEST');
      const approvals = service();
      if (scope === 'controller' && action === 'register-options') {
        exact(body, ['secret']);
        return json(await approvals.registrationOptions(body.secret));
      }
      if (scope === 'controller' && action === 'register') {
        exact(body, ['secret', 'challengeId', 'response']);
        return json(await approvals.register(body.secret, String(body.challengeId), body.response as Parameters<ControllerApprovals['register']>[2]));
      }
      if (scope === 'approval' && action === 'options') {
        exact(body, ['decision']);
        return json(await approvals.decisionOptions(id, body.decision));
      }
      if (scope === 'approval' && action === 'decide') {
        exact(body, ['challengeId', 'response']);
        return json({ escalation: await approvals.decide(id, String(body.challengeId), body.response as Parameters<ControllerApprovals['decide']>[2]) });
      }
      return json({ error: 'NOT_FOUND' }, 404);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const statuses: Record<string, number> = {
        APPROVALS_NOT_CONFIGURED: 503, CONTROLLER_NOT_REGISTERED: 409, CONTROLLER_ALREADY_REGISTERED: 409,
        ENROLLMENT_UNAUTHORIZED: 403, ESCALATION_NOT_FOUND: 404, ESCALATION_CLOSED: 409,
        INVALID_DECISION: 400, INVALID_REQUEST: 400, CHALLENGE_INVALID: 403, PASSKEY_INVALID: 403, PASSKEY_REQUIRED: 403,
        TOO_MANY_CHALLENGES: 429,
      };
      // Crypto errors can contain client data. Return a fixed message, never log the body.
      return json({ error: statuses[code] ? code : 'PASSKEY_REJECTED' }, statuses[code] ?? 403);
    }
  };
}
