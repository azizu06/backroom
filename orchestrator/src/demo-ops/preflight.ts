import type { DemoStatus, HealthRow } from '../../../tools/demo/health';

/** Bounded GETs only: no inference, dialing, payments, or credential output. */
export async function preflight(env: NodeJS.ProcessEnv, status: DemoStatus | undefined, http: typeof fetch = fetch): Promise<HealthRow[]> {
  async function probe(name: string, url: string | undefined, headers?: Record<string, string>, model?: string): Promise<HealthRow> {
    if (!url) return { name, ok: false, detail: 'missing configuration' };
    try {
      const response = await http(url, { headers, redirect: 'error', signal: AbortSignal.timeout(4000) });
      let ok = response.ok;
      if (ok && model) {
        const body = await response.json() as { data?: { id: string }[] };
        ok = body.data?.some(row => row.id === model) === true;
      } else await response.body?.cancel();
      return { name, ok, detail: ok ? 'reachable; read-only check' : response.ok ? 'configured model absent' : `HTTP ${response.status}` };
    } catch { return { name, ok: false, detail: 'unreachable or timed out' }; }
  }
  const bankUrl = env.NESSIE_API_KEY && env.NESSIE_ACCOUNT_ID
    ? `https://prod-api.nessieisreal.com/accounts/${encodeURIComponent(env.NESSIE_ACCOUNT_ID)}?key=${encodeURIComponent(env.NESSIE_API_KEY)}` : undefined;
  const host = (env.DEMO_BIND_HOST || '127.0.0.1').replace(/^\[|\]$/g, '');
  const rows = await Promise.all([
    probe('Web', `http://${host.includes(':') ? `[${host}]` : host}:${env.DEMO_PORT || 3000}/__demo/ping`),
    probe('Cartesia', env.CARTESIA_API_KEY ? 'https://api.cartesia.ai/voices' : undefined,
      { 'X-API-Key': env.CARTESIA_API_KEY || '', 'Cartesia-Version': '2026-08-14' }),
    probe('Nessie', bankUrl),
    probe('GX10 Ollama', `${(env.GX10_BASE_URL || 'http://100.117.44.20:11434/v1').replace(/\/$/, '')}/models`, undefined, env.GX10_MODEL || 'gpt-oss:20b'),
  ]);
  return [
    { name: 'Orchestrator', ok: !!status && status.workersHealthy !== false, detail: status ? 'shared-process host status checked' : 'private demo control unavailable' },
    { name: 'SpacetimeDB', ok: status?.stateStore === 'spacetime', detail: status?.stateStore === 'spacetime' ? 'host adapter read succeeded' : status ? 'unused: memory fallback' : 'host adapter unverified' },
    ...rows,
  ];
}
