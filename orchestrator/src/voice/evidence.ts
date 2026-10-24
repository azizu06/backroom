import type { RequestListener, ServerResponse } from 'node:http';

const fields = (value: unknown, names: string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key]) => names.includes(key)));
};
const redact = (value: unknown): unknown => {
  if (typeof value === 'string') return value.replace(/\+1\d{10}\b|\b\d{3}[- .]\d{3}[- .]\d{4}\b|\b\d{10}\b/g, '[REDACTED_NUMBER]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)]));
  return value;
};

/** Private local evidence only. Never record auth headers or controller traffic. */
export function withVoiceEvidence(handler: RequestListener, record: (line: string) => void): RequestListener {
  return (req, res) => {
    if (!req.url?.startsWith('/api/voice/')) { handler(req, res); return; }
    const at = new Date().toISOString(), start = performance.now(); let raw = '', reply = '';
    req.on('data', chunk => { if (raw.length < 65_536) raw += String(chunk); });
    const originalEnd = res.end;
    res.end = function (this: ServerResponse, chunk: unknown, ...args: unknown[]) {
      reply = typeof chunk === 'string' || Buffer.isBuffer(chunk) ? String(chunk) : '';
      return Reflect.apply(originalEnd, this, [chunk, ...args]);
    } as typeof res.end;
    res.once('finish', () => {
      try {
        const body = fields(JSON.parse(raw), ['type', 'call_id', 'webhook_request_id', 'turn']);
        record(JSON.stringify(redact({ at, path: req.url, status: res.statusCode, server_ms: performance.now() - start,
          body, result: JSON.parse(reply) })));
      } catch {
        // Observability must never interrupt a response or crash the receiver.
        console.warn('Voice evidence unavailable; receiver response preserved.');
      }
    });
    handler(req, res);
  };
}
