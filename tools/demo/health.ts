export interface DemoStatus {
  llmEnabled: boolean; stateStore: 'memory' | 'spacetime'; voice: boolean;
  approvePath?: string; payPath?: string; workersHealthy?: boolean;
}
export interface HealthRow { name: string; ok: boolean; detail: string }
/** Read-only, bounded probes. Never log URLs (Nessie carries its key in a query). */
export async function probeDependencies(options: {
  env: NodeJS.ProcessEnv; status: DemoStatus; live?: boolean; fetch?: typeof fetch;
}): Promise<HealthRow[]> {
  const { env, status } = options;
  const http = options.fetch ?? fetch;
  const probe = async (name: string, url: string | undefined, detail: string): Promise<HealthRow> => {
    if (!options.live || !url) return { name, ok: false, detail: url ? 'not probed; run demo:health --live' : detail };
    try {
      const response = await http(url, { signal: AbortSignal.timeout(4000), redirect: 'error' });
      await response.body?.cancel();
      return { name, ok: response.ok, detail: response.ok ? 'reachable (read only)' : `HTTP ${response.status}` };
    } catch { return { name, ok: false, detail: 'unreachable or timed out' }; }
  };
  const nessie = env.NESSIE_API_KEY && env.NESSIE_ACCOUNT_ID
    ? `https://prod-api.nessieisreal.com/accounts/${encodeURIComponent(env.NESSIE_ACCOUNT_ID)}?key=${encodeURIComponent(env.NESSIE_API_KEY)}` : undefined;
  return [
    { name: 'Web + seats', ok: status.workersHealthy !== false, detail: status.workersHealthy === false ? 'worker stopped' : 'web responding; shared-process seats' },
    { name: 'SpacetimeDB', ok: status.stateStore === 'spacetime', detail: status.stateStore === 'memory' ? 'unused: process-local memory; #15 not installed' : 'adapter connected' },
    await probe('GX10 router', `${(env.GX10_BASE_URL || 'http://100.117.44.20:11434/v1').replace(/\/$/, '')}/models`, 'not configured'),
    { name: 'Cartesia key', ok: !!env.CARTESIA_API_KEY, detail: env.CARTESIA_API_KEY ? 'present; not a call-readiness test' : 'missing' },
    { name: 'Voice relay', ok: status.voice, detail: status.voice ? 'running; no call placed' : 'disabled or not configured' },
    await probe('Nessie', nessie, 'key/account missing; rehearsal bank is mock'),
    await probe('Tunnel', env.DEMO_PUBLIC_URL ? `${env.DEMO_PUBLIC_URL}/__demo/ping` : undefined, 'disabled'),
    { name: 'LLM OFF', ok: !status.llmEnabled, detail: status.llmEnabled ? 'ON; model calls allowed' : 'OFF; code paths remain active' },
    { name: 'Cloud fallback', ok: false, detail: 'unverified; OpenRouter reported 402. Do not promise fallback without a live receipt' },
  ];
}
