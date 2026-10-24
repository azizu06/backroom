// Single local process: Next route chunks, seats, gateway and controller share globals.
import next from 'next';
import { createServer, request as proxyRequest } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createDemoRuntime } from './lib/demo/runtime';

async function main() {
  if (!['memory', 'spacetime'].includes(process.env.STATE_STORE || '')) throw new Error('DEMO_STATE_REQUIRED');
  const port = Number(process.env.DEMO_PORT || 3000);
  const origin = new URL(process.env.DEMO_PUBLIC_URL || `http://localhost:${port}`);
  // Next's hostname/port describe the public reverse-proxy origin, not our listen socket.
  const app = next({ dev: false, dir: fileURLToPath(new URL('.', import.meta.url)),
    hostname: origin.hostname, port: Number(origin.port || (origin.protocol === 'https:' ? 443 : 80)) });
  await app.prepare();
  const runtime = await createDemoRuntime();
  const handle = app.getRequestHandler();
  const active = new Set<Promise<void>>();
  let resetting = false;
  const server = createServer(async (req, res) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path === '/__demo/ping') { res.setHeader('Cache-Control', 'no-store'); res.end(`demo ${runtime.status().bank}; ${process.env.STATE_STORE} state`); return; }
    if (path.startsWith('/__demo/')) {
      const actual = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${process.env.DEMO_CONTROL_SECRET}`);
      if (!process.env.DEMO_CONTROL_SECRET || actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.writeHead(401).end(); return; }
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('Content-Type', 'application/json');
      if (path === '/__demo/health' && req.method === 'GET') {
        res.end(JSON.stringify(await runtime.health())); return;
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
    if (path.startsWith('/_cartesia/')) {
      if (process.env.DEMO_VOICE_RUNNING !== '1') { res.writeHead(503).end('Voice relay disabled'); return; }
      const upstream = proxyRequest({ hostname: '127.0.0.1', port: Number(process.env.VOICE_PORT || 8788),
        path: (req.url || '').slice('/_cartesia'.length), method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${process.env.VOICE_PORT || 8788}` }, timeout: 10000 }, response => {
        res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
      });
      upstream.on('timeout', () => upstream.destroy());
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Relay unavailable'); });
      req.pipe(upstream); return;
    }
    let finish!: () => void;
    const done = new Promise<void>(resolve => { finish = resolve; }); active.add(done);
    const settled = () => { active.delete(done); finish(); };
    res.once('finish', settled); res.once('close', settled);
    try { await handle(req, res); } catch { if (!res.headersSent) res.writeHead(500); res.end('Demo request failed'); }
  });
  server.listen(port, '127.0.0.1');
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    if (closing) return; closing = true;
    server.close(); void runtime.stop().then(() => app.close()).finally(() => process.exit(0));
  });
  console.log(`Demo ready: shared state, ${runtime.status().bank}, no phone call placed.`);

}
main().catch(() => { console.error('DEMO_WEB_START_FAILED'); process.exit(1); });
