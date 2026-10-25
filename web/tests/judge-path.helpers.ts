import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** Only the isolated rehearsal host; these helpers never request a phone call. */
export function localJudgeOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.port) {
    throw new Error('Judge path requires an explicitly ported loopback host');
  }
  return url.origin;
}

export async function virtualDana(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  return cdp;
}

export function judgeGateway(request: APIRequestContext, origin: string, secret: string, callId: string) {
  const local = localJudgeOrigin(origin);
  let sequence = 0;
  return async (name: string, args: Record<string, unknown> = {}) => {
    const response = await request.post(`${local}/api/tools/${name}`, {
      headers: { authorization: `Bearer ${secret}` },
      data: { ...args, call_id: callId, webhook_request_id: `${callId}:${++sequence}` },
    });
    expect(response.ok(), `Gateway ${name}: HTTP ${response.status()}`).toBe(true);
    return response.json();
  };
}
