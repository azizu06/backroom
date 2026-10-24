import { createServer, type RequestListener } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAttackDemoHandler } from './http';

/** Private controller transport; never put TOOL_GATEWAY_SECRET in client-side code. */
export function createAttackDemoListener(handler = createAttackDemoHandler()): RequestListener {
  return async (req, res) => {
    const noStore = { 'Cache-Control': 'no-store' };
    if (req.url !== '/api/attack-demo') { res.writeHead(404, noStore).end(); return; }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) { res.writeHead(413, noStore).end(); return; }
        chunks.push(chunk);
      }
      const headers = new Headers();
      for (const name of ['authorization', 'content-type']) {
        const value = req.headers[name];
        if (typeof value === 'string') headers.set(name, value);
      }
      const response = await handler(new Request('http://localhost/api/attack-demo', { method: req.method, headers,
        ...(!['GET', 'HEAD'].includes(req.method ?? 'GET') ? { body: Buffer.concat(chunks) } : {}) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(503, noStore).end(); }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const envFile = fileURLToPath(new URL('../../../.env.local', import.meta.url));
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const server = createServer(createAttackDemoListener());
  server.requestTimeout = 30_000;
  server.listen(Number(process.env.ATTACK_DEMO_PORT ?? 8790), '127.0.0.1', () => console.log('Private attack demo ready. Assessment only; no payment adapter.'));
}
