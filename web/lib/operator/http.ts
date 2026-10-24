import { randomUUID } from 'node:crypto';
import type { StateStore } from '@backroom/orchestrator';
import { isOperatorAction, type OperatorAction } from './catalog';
import { operatorOriginAllowed, operatorSessionValid } from './session';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export function createOperatorHTTP(options: {
  env: () => Record<string, string | undefined>; store: () => StateStore; run: (action: OperatorAction) => Promise<unknown>;
}) {
  let busy = false;
  return async (action: string, request: Request) => {
    const env = options.env();
    if (!env.DEMO_CONTROL_SECRET) return json({ error: 'Operator console requires the owned demo host.' }, 503);
    if (!operatorOriginAllowed(request, env)) return json({ error: 'Origin rejected.' }, 403);
    if (!operatorSessionValid(request, env)) return json({ error: 'Unlock the console on the host’s local address.' }, 401);
    if (action === 'session' && request.method === 'GET') return json({ authorized: true });
    if (action === 'logout' && request.method === 'POST') return new Response(null, { status: 204, headers: {
      'Cache-Control': 'no-store', 'Set-Cookie': 'backroom_operator=; Path=/api/operator; HttpOnly; SameSite=Strict; Max-Age=0',
    } });
    if (!isOperatorAction(action)) return json({ error: 'Unknown operator action.' }, 404);
    if (request.method !== 'POST') return json({ error: 'POST required.' }, 405);
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return json({ error: 'JSON required.' }, 415);
    // Read a bounded stream; a missing or forged Content-Length cannot bypass the cap.
    let raw = '';
    const reader = request.body?.getReader();
    if (reader) {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        raw += Buffer.from(value).toString();
        if (raw.length > 64) { await reader.cancel(); return json({ error: 'Request too large.' }, 413); }
      }
    }
    try { const body = JSON.parse(raw); if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length) throw new Error(); }
    catch { return json({ error: 'Actions accept only an empty JSON object.' }, 400); }
    const requestId = `operator:${randomUUID()}`;
    const audit = async (phase: string) => {
      const store = options.store(); // Reset replaces the adapter; reacquire for the completion record.
      return store.appendAudit({ ts: Date.now(), actor: 'code', seat: 'controller', action: `operator_${action}`, ruleIds: [],
        policyVersion: (await store.getPolicy()).policyVersion, refs: [requestId], route: 'code', latencyMs: 0, costUsd: 0,
        inputs: { requestId, phase, operatorSession: true, noDial: true, approvalAuthority: false } });
    };
    const exclusive = action !== 'llm_off'; // OFF must be able to abort a running warm-up/burst.
    if (busy && exclusive) { await audit('rejected'); return json({ error: 'Another operator action is running.' }, 409); }
    if (exclusive) busy = true;
    try {
      await audit('started'); // Fail closed before effects if the audit adapter is unavailable.
      const result = await options.run(action);
      const failed = !!result && typeof result === 'object' && 'failed' in result && result.failed === true;
      const entry = await audit(failed ? 'failed' : 'completed');
      return json({ result, requestId, auditHref: `/audit?entry=${encodeURIComponent(entry.id)}`,
        ...(failed ? { error: 'Proof run failed. See the retained output.' } : {}) }, failed ? 422 : 200);
    } catch {
      try { await audit('failed'); } catch { /* Never return untrusted adapter details. */ }
      return json({ error: 'Action failed or its completion could not be recorded. Check the audit before retrying.', requestId }, 503);
    } finally { if (exclusive) busy = false; }
  };
}
