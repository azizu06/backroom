import type { RouterTelemetry } from '@backroom/orchestrator';

export interface Gx10Status {
  measuredAt: string;
  reachable: boolean;
  models: string[];
  telemetry: RouterTelemetry | null;
  gpuUtilization: null;
}

/** Fixed server-configured destination, read-only, no inference or SSH. */
export function createGx10Reader(options: {
  fetch?: typeof fetch; now?: () => number; baseUrl?: string;
  telemetry: () => RouterTelemetry | null;
}) {
  const http = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let cached: Gx10Status | undefined;
  let expiresAt = 0;
  let inFlight: Promise<Gx10Status> | undefined;
  async function probe(): Promise<Gx10Status> {
    let reachable = false;
    let models: string[] = [];
    try {
      const base = new URL(options.baseUrl ?? process.env.GX10_BASE_URL ?? 'http://100.117.44.20:11434/v1');
      base.pathname = base.pathname.replace(/\/v1\/?$/, '').replace(/\/$/, '') + '/api/ps';
      base.search = ''; base.hash = '';
      const response = await http(base.toString(), { signal: AbortSignal.timeout(1500), cache: 'no-store', redirect: 'error' });
      if (!response.ok || !response.body) throw new Error('GX10 probe failed');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 65536) throw new Error('GX10 response too large');
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (!body || typeof body !== 'object' || !('models' in body) || !Array.isArray(body.models)
        || body.models.length > 64 || body.models.some(row => !row || typeof row.name !== 'string')) throw new Error('Invalid GX10 response');
      models = body.models.slice(0, 12).map((row: { name: string }) => row.name.slice(0, 80));
      reachable = true;
    } catch { /* Redacted offline state. Never return upstream errors or credentials. */ }
    return { measuredAt: new Date(now()).toISOString(), reachable, models,
      telemetry: options.telemetry(), gpuUtilization: null };
  }
  return async function read(): Promise<Gx10Status> {
    if (cached && now() < expiresAt) return cached;
    if (!inFlight) inFlight = probe().then(status => {
      cached = status; expiresAt = now() + 2000; return status;
    }).finally(() => { inFlight = undefined; });
    return inFlight;
  };
}
