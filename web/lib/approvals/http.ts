import type { ControllerApprovals } from '@backroom/orchestrator';
import { applyInboxBankChange } from '../inbox/proposals';

type JSONBody = Record<string, unknown>;
function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
const SESSION_COOKIE = 'backroom_controller';
function sessionToken(request: Request) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) return value.join('=');
  }
}
function exact(body: JSONBody, keys: string[]) {
  if (Object.keys(body).sort().join(',') !== keys.sort().join(',')) throw new Error('INVALID_REQUEST');
}
/** Origin is deployment config, never derived from Host/X-Forwarded-Host.
 * `inboxIds` names the escalations a signed-in controller can list; each is re-read and filtered by the service. */
export function createApprovalHTTP(service: () => ControllerApprovals, origin: () => string | undefined,
  inboxIds: () => readonly string[] = () => []) {
  return async (scope: 'controller' | 'approval', id: string, action: string, request: Request) => {
    try {
      if (request.method === 'GET') {
        const approvals = service();
        if (scope === 'controller' && action === 'inbox') {
          if (!approvals.hasSession(sessionToken(request))) return json({ error: 'SESSION_REQUIRED' }, 401);
          return json({ escalations: await approvals.pending(inboxIds()) });
        }
        if (action !== 'view') return json({ error: 'NOT_FOUND' }, 404);
        return json(scope === 'controller' ? { registered: approvals.isRegistered(), signedIn: approvals.hasSession(sessionToken(request)) }
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
      if (scope === 'controller' && action === 'session-options') {
        exact(body, []);
        return json(await approvals.sessionOptions());
      }
      if (scope === 'controller' && action === 'session') {
        exact(body, ['challengeId', 'response']);
        const { token, maxAgeSeconds } = await approvals.signIn(String(body.challengeId), body.response as Parameters<ControllerApprovals['signIn']>[1]);
        const secure = origin()!.startsWith('https:') ? '; Secure' : '';
        return json({ signedIn: true }, 200, { 'Set-Cookie':
          `${SESSION_COOKIE}=${token}; Path=/api/controller; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure}` });
      }
      if (scope === 'approval' && action === 'options') {
        exact(body, ['decision']);
        return json(await approvals.decisionOptions(id, body.decision));
      }
      if (scope === 'approval' && action === 'decide') {
        exact(body, ['challengeId', 'response']);
        const escalation = await approvals.decide(id, String(body.challengeId), body.response as Parameters<ControllerApprovals['decide']>[2]);
        // The passkey is already recorded. A missing proposal leaves that decision unchanged.
        const bankChange = await applyInboxBankChange(id).catch(() => undefined);
        return json(bankChange ? { escalation, bankChange } : { escalation });
      }
      return json({ error: 'NOT_FOUND' }, 404);
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      const statuses: Record<string, number> = {
        APPROVALS_NOT_CONFIGURED: 503, CONTROLLER_NOT_REGISTERED: 409, CONTROLLER_ALREADY_REGISTERED: 409,
        ENROLLMENT_UNAUTHORIZED: 403, ESCALATION_NOT_FOUND: 404, ESCALATION_CLOSED: 409,
        INVALID_DECISION: 400, INVALID_REQUEST: 400, CHALLENGE_INVALID: 403, PASSKEY_INVALID: 403, PASSKEY_REQUIRED: 403,
        TOO_MANY_CHALLENGES: 429, SESSION_REQUIRED: 401,
      };
      // Crypto errors can contain client data. Return a fixed message, never log the body.
      return json({ error: statuses[code] ? code : 'PASSKEY_REJECTED' }, statuses[code] ?? 403);
    }
  };
}
