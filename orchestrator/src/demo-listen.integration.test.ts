import { networkInterfaces } from 'node:os';
import { describe, expect, it } from 'vitest';
import { listenDemo } from '../../tools/demo/listen';
import { createDemoVoiceBridge } from './voice/demo-bridge';

// Local HTTP integration only: no provider, database, dial, payment, or external request.
describe('demo listeners and private voice bridge', () => {
  it('serves a non-loopback view and bridge gateway/admin requests on the same port', async () => {
    const host = Object.values(networkInterfaces()).flat().find(row => row?.family === 'IPv4' && !row.internal)?.address;
    if (!host) throw new Error('This local integration test requires a non-loopback IPv4 interface');
    const seen: string[] = [];
    const listeners = await listenDemo((req, res) => {
      if (req.headers.authorization !== 'Bearer private-test-control') { res.writeHead(401).end(); return; }
      seen.push(req.url!);
      if (req.url === '/__demo/voice-client-stopped') {
        expect(req.headers.host).toBe(`127.0.0.1:${listeners.port}`);
        expect(req.socket.remoteAddress).toBe('127.0.0.1');
        res.end('{"stopped":false}'); return;
      }
      res.setHeader('content-type', 'application/json'); res.end('{"kind":"RECORDED"}');
    }, 0, host);
    try {
      const bridge = createDemoVoiceBridge({ port: listeners.port, controlSecret: 'private-test-control', publicOrigin: 'https://demo.example' });
      expect(await bridge.clientStopped()).toBe(false);
      const response = await bridge.gateway('get_invoice_context', new Request('https://demo.example/api/tools/get_invoice_context', {
        method: 'POST', headers: { authorization: 'Bearer private-test-control' }, body: '{}',
      }));
      expect(await response.json()).toEqual({ kind: 'RECORDED' });
      const external = await fetch(`http://${host}:${listeners.port}/view`, { headers: { authorization: 'Bearer private-test-control' } });
      expect(external.status).toBe(200); await external.body?.cancel();
      expect(seen).toEqual(['/__demo/voice-client-stopped', '/api/tools/get_invoice_context', '/view']);
    } finally { await listeners.close(); }
    await expect(fetch(`http://127.0.0.1:${listeners.port}`)).rejects.toThrow();
    await expect(fetch(`http://${host}:${listeners.port}`)).rejects.toThrow();
  });
  it('uses one listener for the default loopback host', async () => {
    const listeners = await listenDemo((_req, res) => res.end('ok'), 0, '127.0.0.1');
    try { expect(await fetch(`http://127.0.0.1:${listeners.port}`).then(res => res.text())).toBe('ok'); }
    finally { await listeners.close(); }
  });
});
