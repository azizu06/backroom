import { createServer, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { withVoiceEvidence } from './evidence';

describe('voice receiver evidence', () => {
  it('preserves webhook responses and numeric timings while redacting speech numbers', async () => {
    const records: string[] = [];
    const handler: RequestListener = (req, res) => {
      req.resume();
      req.on('end', () => res.writeHead(200).end(JSON.stringify({ ok: true, latency: 123.456789012 })));
    };
    const server = createServer(withVoiceEvidence(handler, line => records.push(line)));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing address');
    try {
      const r = await fetch(`http://127.0.0.1:${address.port}/api/voice/cartesia`, { method: 'POST',
        headers: { authorization: 'Bearer secret-must-not-log' },
        body: JSON.stringify({ type: 'call_turn', call_id: 'ac_test', secret: 'body-secret-must-not-log',
          turn: { role: 'user', text: 'Call +12025550123', was_interrupted: false } }) });
      expect(r.status).toBe(200); expect(await r.json()).toEqual({ ok: true, latency: 123.456789012 });
      expect(records).toHaveLength(1);
      const record = JSON.parse(records[0]!);
      expect(record.result.latency).toBe(123.456789012);
      expect(record.body.turn.text).toBe('Call [REDACTED_NUMBER]');
      expect(Number.isFinite(record.server_ms)).toBe(true);
      expect(records[0]).not.toContain('must-not-log');
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('keeps serving when evidence storage fails or the webhook body is invalid', async () => {
    const server = createServer(withVoiceEvidence((req, res) => {
      req.resume(); req.on('end', () => res.writeHead(200).end('{"ok":true}'));
    }, () => { throw Error('disk unavailable'); }));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing address');
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      for (const body of ['{}', 'invalid JSON']) {
        const r = await fetch(origin + '/api/voice/cartesia', { method: 'POST', body });
        expect(r.status).toBe(200); expect(await r.json()).toEqual({ ok: true });
      }
      expect((await fetch(origin + '/health')).status).toBe(200);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });

});
