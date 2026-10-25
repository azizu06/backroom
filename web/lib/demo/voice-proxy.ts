import { request, type IncomingMessage, type ServerResponse } from 'node:http';

/** Above every Cartesia tool deadline (check_approval: 20 s) so a held approval check is never cut off here. */
export const VOICE_RELAY_TIMEOUT_MS = 25_000;

/** Forwards one Cartesia webhook or tool request to the local voice relay. */
export function proxyVoiceRelay(req: IncomingMessage, res: ServerResponse, relayPath: string, relayPort: number, timeoutMs = VOICE_RELAY_TIMEOUT_MS) {
  const upstream = request({ hostname: '127.0.0.1', port: relayPort,
    path: relayPath + new URL(req.url || '/', 'http://localhost').search, method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${relayPort}` }, timeout: timeoutMs }, response => {
    res.writeHead(response.statusCode || 502, response.headers); response.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('RELAY_TIMEOUT')));
  upstream.on('error', error => {
    // Path and error code only: headers and bodies carry secrets and call content.
    console.error(`VOICE_RELAY_PROXY_FAILED ${relayPath} ${(error as NodeJS.ErrnoException).code || error.message}`);
    if (!res.headersSent) res.writeHead(502); res.end('Relay unavailable');
  });
  req.pipe(upstream);
}
