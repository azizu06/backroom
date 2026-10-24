import { createServer, type RequestListener } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createHandoffHandler } from './handoff';

/** Private localhost service. A trusted office controller proxies /api/handoff. */
export function createHandoffListener(handler = createHandoffHandler()): RequestListener {
  return async (req, res) => {
    if (req.url !== '/api/handoff') { res.writeHead(404).end(); return; }
    try {
      let raw = Buffer.alloc(0);
      for await (const chunk of req) {
        raw = Buffer.concat([raw, chunk]);
        if (raw.length > 4096) { res.writeHead(413, { 'Cache-Control': 'no-store' }).end(); return; }
      }
      const headers = new Headers();
      for (const name of ['authorization', 'content-type']) {
        const value = req.headers[name]; if (typeof value === 'string') headers.set(name, value);
      }
      const response = await handler(new Request('http://localhost/api/handoff', { method: req.method, headers,
        ...(!['GET', 'HEAD'].includes(req.method ?? 'GET') ? { body: raw } : {}) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(503, { 'Cache-Control': 'no-store' }).end(); }
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer(createHandoffListener());
  server.requestTimeout = 30_000;
  server.listen(Number(process.env.HANDOFF_PORT ?? 8789), '127.0.0.1', () => console.log('Private handoff TTS ready. No calls placed.'));
}
