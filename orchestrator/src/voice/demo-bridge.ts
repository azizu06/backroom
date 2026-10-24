/** Voice is a client of demo:up's authoritative gateway, never a second payment store. */
export function createDemoVoiceBridge(options: { port: number; controlSecret: string; publicOrigin: string; fetch?: typeof fetch }) {
  const origin = new URL(options.publicOrigin);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password
    || /^(localhost|127\.|\[::1\])/.test(origin.hostname)) throw new Error('PUBLIC_HTTPS_ORIGIN_REQUIRED');
  const send = options.fetch ?? fetch;
  const base = `http://127.0.0.1:${options.port}`;
  const admin = async (path: string, body?: object) => {
    const response = await send(`${base}/__demo/${path}`, { method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${options.controlSecret}`, 'content-type': 'application/json' },
      ...(body && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error('DEMO_VOICE_STATE_UNAVAILABLE');
    return response.json();
  };
  return {
    register: (sessionId: string) => admin('voice-call', { sessionId }),
    endCall: (sessionId: string) => admin('voice-call-ended', { sessionId }),
    clientStopped: async () => (await admin('voice-client-stopped')).stopped as boolean,
    gateway: async (tool: string, request: Request) => {
      const response = await send(`${base}/api/tools/${encodeURIComponent(tool)}`, {
        method: 'POST', headers: request.headers, body: await request.text(), signal: AbortSignal.timeout(1500),
      });
      if (!response.ok || tool !== 'send_payment_link') return response;
      const result = await response.json();
      if (result.kind === 'RECORDED' && /^[A-F0-9]{10}$/.test(result.short_code)) {
        const code = result.short_code as string;
        result.payment_url = `${origin.origin}/p/${code}`;
        result.speak = `Your payment page is ready. Scan the QR code on the office screen, or visit ${origin.host}, slash p, slash ${code.split('').join(' ')}. The code expires in fifteen minutes. No text message was sent.`;
      }
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    },
  };
}
