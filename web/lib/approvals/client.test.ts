import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApprovalError, approvalRequest } from './client';

const respond = (status: number, body: string, type = 'application/json') =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'content-type': type } })));
const failure = (promise: Promise<unknown>) => promise.then(() => { throw new Error('expected a rejection'); }, (e: unknown) => e as ApprovalError);

afterEach(() => { vi.unstubAllGlobals(); });

describe('approvalRequest', () => {
  it('returns the JSON body on success', async () => {
    respond(200, '{"registered":true}');
    await expect(approvalRequest('/api/controller/view')).resolves.toEqual({ registered: true });
  });

  it('maps a known server code and keeps it on the error', async () => {
    respond(404, '{"error":"ESCALATION_NOT_FOUND"}');
    const error = await failure(approvalRequest('/api/approvals/x/view'));
    expect(error).toBeInstanceOf(ApprovalError);
    expect(error.code).toBe('ESCALATION_NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.message).toBe('This approval request could not be found. Check the link.');
  });

  it('turns an HTML error page into a readable outage message, not a parse error', async () => {
    respond(502, '<html><body>Bad gateway</body></html>', 'text/html');
    const error = await failure(approvalRequest('/api/controller/view'));
    expect(error.message).toBe('Backroom is not responding right now (HTTP 502). Try again in a moment.');
    expect(error.code).toBeUndefined();
  });

  it('treats a 200 with a non-JSON body as an outage too', async () => {
    respond(200, 'ok', 'text/plain');
    expect((await failure(approvalRequest('/api/controller/view'))).message).toContain('HTTP 200');
  });

  it('treats a JSON null body as an outage instead of returning null', async () => {
    respond(200, 'null');
    expect((await failure(approvalRequest('/api/approvals/x/view'))).message).toContain('HTTP 200');
  });

  it('does not blame the passkey when a page load fails with an unknown code', async () => {
    respond(500, '{"error":"SOMETHING_NEW"}');
    expect((await failure(approvalRequest('/api/controller/view'))).message).toBe('This page could not be loaded. Try again in a moment.');
    respond(500, '{"error":"SOMETHING_NEW"}');
    expect((await failure(approvalRequest('/api/controller/register', {}))).message).toBe('Your passkey could not be verified. Try again with Dana’s passkey.');
  });

  it('ignores prototype keys as error codes', async () => {
    respond(400, '{"error":"constructor"}');
    expect((await failure(approvalRequest('/api/controller/view'))).message).toBe('This page could not be loaded. Try again in a moment.');
  });

  it('reports a network failure without a raw TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const error = await failure(approvalRequest('/api/controller/view'));
    expect(error.code).toBe('NETWORK');
    expect(error.message).toBe('Backroom could not be reached. Check the connection and try again.');
  });
});
