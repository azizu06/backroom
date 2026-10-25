// Single local process: Next route chunks, seats, gateway and controller share globals.
import next from 'next';
import { demoBindHost, voiceRelayPath } from '../tools/demo/host';
import type { RequestListener } from 'node:http';
import { listenDemo } from '../tools/demo/listen';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDemoRuntime } from './lib/demo/runtime';
import { recordVoiceCallEvent } from './lib/calls/lifecycle';
import { localOperatorRequest } from './lib/operator/session';
import { localOperatorSessionCookie } from './lib/operator/sign-in';
import { operatorAudit } from './lib/operator/audit';
import { proxyStateHTTP, proxyStateUpgrade, stateProxyEnabled } from './lib/demo/state-proxy';
import { proxyVoiceRelay } from './lib/demo/voice-proxy';

async function main() {
  if (!['memory', 'spacetime'].includes(process.env.STATE_STORE || '')) throw new Error('DEMO_STATE_REQUIRED');
  const port = Number(process.env.DEMO_PORT || 3000);
  // The office then subscribes through this host's own origin, so the public URL gets live state.
  if (stateProxyEnabled(process.env)) process.env.DEMO_STATE_PROXY = '1';
  const origin = new URL(process.env.DEMO_PUBLIC_URL || `http://localhost:${port}`);
  // Next's hostname/port describe the public reverse-proxy origin, not our listen socket.
  const app = next({ dev: false, dir: fileURLToPath(new URL('.', import.meta.url)),
    hostname: origin.hostname, port: Number(origin.port || (origin.protocol === 'https:' ? 443 : 80)) });
  await app.prepare();
  const runtime = await createDemoRuntime();
  const handle = app.getRequestHandler();
  const active = new Set<Promise<void>>();
  let resetting = false;
  const handler: RequestListener = async (req, res) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path === '/__demo/ping') { res.setHeader('Cache-Control', 'no-store'); res.end(`demo ${runtime.status().bank}; ${process.env.STATE_STORE} state`); return; }
    if (path === '/__operator/session') {
      res.setHeader('Cache-Control', 'no-store');
      // Public reverse proxies can have a loopback socket. Host+Origin must ALSO be the private numeric address.
      if (req.method !== 'POST' || !localOperatorRequest(req.socket.remoteAddress, req.headers.host, req.headers.origin, port)) {
        res.writeHead(403).end('Unlock on the host’s local operator page.'); return;
      }
      try {
        const cookie = localOperatorSessionCookie(process.env, `http://127.0.0.1:${port}`);
        await operatorAudit('session', 'operator:local-host', 'completed');
        res.setHeader('Set-Cookie', cookie); res.end('{}');
      } catch { res.writeHead(503).end('Operator session unavailable.'); }
      return;
    }
    if (path.startsWith('/__demo/')) {
      const actual = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${process.env.DEMO_CONTROL_SECRET}`);
      if (!process.env.DEMO_CONTROL_SECRET || actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.writeHead(401).end(); return; }
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
      if (path === '/__demo/health' && req.method === 'GET') {
        res.end(JSON.stringify(await runtime.health())); return;
      }
      if (path === '/__demo/voice-call' || path === '/__demo/voice-call-ended' || path === '/__demo/voice-client-stopped' || path === '/__demo/voice-call-event') {
        // Tunnel requests also arrive on loopback: require the private Host as well.
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')
          || req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(403).end('{}'); return; }
        try {
          if (path.endsWith('voice-client-stopped') && req.method === 'GET') {
            res.end(JSON.stringify({ stopped: await runtime.clientStopped() })); return;
          }
          if ((path === '/__demo/voice-call' || path === '/__demo/voice-call-ended') && req.method === 'POST') {
            let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1024) throw new Error('TOO_LARGE'); }
            const body = JSON.parse(raw);
            if (!body || Object.keys(body).length !== 1 || typeof body.sessionId !== 'string') throw new Error('INVALID_SESSION');
            if (path === '/__demo/voice-call-ended') await runtime.endVoiceCall(body.sessionId);
            else { await runtime.registerVoiceCall(body.sessionId); recordVoiceCallEvent(body.sessionId, 'registered'); }
            res.end('{"ok":true}'); return;
          }
          if (path.endsWith('voice-call-event') && req.method === 'POST') {
            // Provider lifecycle for the office desk phone; times only, never call content.
            let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 1024) throw new Error('TOO_LARGE'); }
            const body = JSON.parse(raw);
            if (!body || Object.keys(body).length !== 2 || typeof body.sessionId !== 'string' || !['started', 'completed', 'failed'].includes(body.event)) throw new Error('INVALID_EVENT');
            recordVoiceCallEvent(body.sessionId, body.event);
            await runtime.voiceCallEvent(body.sessionId, body.event);
            res.end('{"ok":true}'); return;
          }
          res.writeHead(405).end('{}');
        } catch { res.writeHead(409).end('{"error":"VOICE_REGISTRATION_FAILED"}'); }
        return;
      }
      if (path === '/__demo/status' && req.method === 'GET') {
        try { await runtime.check();
          let voice = false;
          if (process.env.DEMO_VOICE_RUNNING === '1') {
            try { voice = (await fetch(`http://127.0.0.1:${process.env.VOICE_PORT || 8788}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* relay down */ }
          }
          res.end(JSON.stringify({ ...runtime.status(), voice }));
        } catch { res.writeHead(503).end('{"error":"STATE_UNAVAILABLE"}'); }
        return;
      }
      if (path === '/__demo/reset' && req.method === 'POST' && !resetting) {
        resetting = true;
        try { await Promise.all([...active]); let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 8192) throw new Error('RESET_TOO_LARGE'); }
          const config = JSON.parse(raw || '{}');
          await runtime.reset(process.env.STATE_STORE === 'spacetime' ? config : undefined);
          if (process.env.STATE_STORE === 'spacetime') {
            // The server-rendered office must subscribe to the freshly installed database.
            process.env.SPACETIMEDB_URI = config.uri;
            process.env.SPACETIMEDB_DATABASE = config.database;
          }
          res.end(JSON.stringify(runtime.status())); }
        catch { res.writeHead(503).end('{"error":"DEMO_RESET_FAILED"}'); }
        finally { resetting = false; }
        return;
      }
      res.writeHead(409).end(); return;
    }
    if (resetting) { res.writeHead(503).end('Demo resetting; retry shortly'); return; }
    if (proxyStateHTTP(req, res)) return;
    const relayPath = voiceRelayPath(path);
    if (relayPath !== undefined) {
      if (process.env.DEMO_VOICE_RUNNING !== '1') { res.writeHead(503).end('Voice relay disabled'); return; }
      proxyVoiceRelay(req, res, relayPath, Number(process.env.VOICE_PORT || 8788)); return;
    }
    let finish!: () => void;
    // Reset returns through the supervisor into /__demo/reset, which drains active requests.
    // Counting the initiating request would make it wait for itself. The operator gate serializes its actions.
    const done = new Promise<void>(resolve => { finish = resolve; });
    if (path !== '/api/operator/reset') active.add(done);
    const settled = () => { active.delete(done); finish(); };
    res.once('finish', settled); res.once('close', settled);
    try { await handle(req, res); } catch { if (!res.headersSent) res.writeHead(500); res.end('Demo request failed'); }
  };
  const host = demoBindHost(process.env);
  const listeners = await listenDemo(handler, port, host, (req, socket, head) => proxyStateUpgrade(req, socket, head));
  console.log(`Demo bound: ${host}:${port}${host === '127.0.0.1' ? '' : ` and 127.0.0.1:${port}`}`);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    if (closing) return; closing = true;
    void listeners.close().then(() => runtime.stop()).then(() => app.close()).finally(() => process.exit(0));
  });
  console.log(`Demo ready: shared state, ${runtime.status().bank}, no phone call placed.`);

}
main().catch(() => { console.error('DEMO_WEB_START_FAILED'); process.exit(1); });
