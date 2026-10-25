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

/** Scripted provider turns through the production relay. No telephony transport is installed. */
export async function judgeVoice(request: APIRequestContext, origin: string, callId: string) {
  const local = localJudgeOrigin(origin);
  const reset = await request.post(`${local}/__judge/reset`, {
    headers: { authorization: 'Bearer judge-local-tool' }, data: {},
  });
  expect(reset.ok()).toBe(true);
  const registered = await request.post(`${local}/__judge/call`, {
    headers: { authorization: 'Bearer judge-local-tool' }, data: { callId },
  });
  expect(registered.ok()).toBe(true);
  const fixture = await registered.json();
  let nonce = fixture.nonce;
  let sequence = 0;
  const event = async (type: string, turn?: Record<string, unknown>) => {
    const response = await request.post(`${local}/api/voice/cartesia`, {
      headers: { 'x-webhook-secret': 'judge-local-event' },
      data: { type, call_id: callId, webhook_request_id: `${callId}:event:${++sequence}`, ...(turn && { turn }) },
    });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const turn = (role: 'assistant' | 'user', text: string) => event('call_turn', { role, text, was_interrupted: false });
  await turn('assistant', fixture.welcome);
  return { turn, complete: () => event('call_completed'),
    async tool(name: string, args: Record<string, unknown> = {}) {
      const response = await request.post(`${local}/api/voice/tools/${name}`, {
        headers: { authorization: 'Bearer judge-local-relay' },
        data: { ...args, call_id: callId, webhook_request_id: nonce },
      });
      expect(response.ok()).toBe(true);
      const result = await response.json();
      nonce = result.next_delivery_nonce;
      return result;
    } };
}
