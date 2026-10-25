export interface DemoStatus {
  live?: boolean; bank?: 'mock' | 'nessie_sandbox'; services?: { preCall?: { status: string; reason?: string; signals?: Record<string, unknown> }; model: { mode: string; cloud: string }; nessie: { mode: string; proof?: { kind: 'sandbox_read' | 'deposit_exact_match'; at: string; depositId?: string }; unreachableAt?: string }; apify: { mode: string; status: string; runId?: string }; crs: { mode: string; status: string; products: string[]; ofac: string; businessCredit: string } };
  llmEnabled: boolean; stateStore: 'memory' | 'spacetime'; voice: boolean;
  approvePath?: string; workersHealthy?: boolean; tunnelUrl?: string;
  attackDemo?: HealthRow;
  envChecks?: import('./env').DemoEnvironmentCheck[];
}
export interface HealthRow { name: string; ok: boolean; detail: string }
function environmentRows(status: DemoStatus, hostRows: HealthRow[] = []): HealthRow[] {
  const observed = new Set(hostRows.map(row => row.name));
  return (status.envChecks ?? []).map(row => {
    const detail = [
      ...(row.missing.length ? [`missing: ${row.missing.join(', ')}`] : []),
      ...(row.defaulted.length ? [`defaulted: ${row.defaulted.join(', ')}`] : []),
    ].join('; ');
    return { name: `Required env (${row.process})`, ok: !detail, detail: detail || 'all required variables explicitly configured' };
  }).filter(row => !observed.has(row.name));
}
/** Local authenticated GET only. The private supervisor owns this bearer, never the CLI output. */
export async function probeAttackDemo(env: NodeJS.ProcessEnv, http: typeof fetch = fetch): Promise<HealthRow> {
  const name = 'Attack demo';
  if (!env.ATTACK_DEMO_BASE_URL || !env.TOOL_GATEWAY_SECRET) return { name, ok: false, detail: 'not configured' };
  try {
    const response = await http(`${env.ATTACK_DEMO_BASE_URL}/api/attack-demo`, {
      headers: { authorization: `Bearer ${env.TOOL_GATEWAY_SECRET}` },
      signal: AbortSignal.timeout(4000), redirect: 'error',
    });
    await response.body?.cancel();
    return { name, ok: response.ok, detail: response.ok
      ? `reachable (${env.ATTACK_DEMO_LIVE === '1' ? 'live enabled' : 'mock'})` : `HTTP ${response.status}` };
  } catch { return { name, ok: false, detail: 'unreachable or timed out' }; }
}
/** Read-only, bounded probes. Never log URLs (Nessie carries its key in a query). */
export async function probeDependencies(options: {
  env: NodeJS.ProcessEnv; status: DemoStatus; live?: boolean; fetch?: typeof fetch; hostRows?: HealthRow[];
}): Promise<HealthRow[]> {
  const { env, status } = options;
  const http = options.fetch ?? fetch;
  const probe = async (name: string, url: string | undefined, detail: string): Promise<HealthRow> => {
    if (!options.live || !url) return { name, ok: false, detail: url ? 'not probed; run demo:health --live' : detail };
    try {
      const response = await http(url, { signal: AbortSignal.timeout(4000), redirect: 'error' });
      if (name === 'GX10 router' && response.ok) {
        const body = await response.json() as { data?: { id?: string }[] };
        const ok = body.data?.some(row => row.id === (env.GX10_MODEL || 'gpt-oss:20b')) === true;
        return { name, ok, detail: ok ? 'configured model listed; no inference made' : 'configured model absent' };
      }
      await response.body?.cancel();
      return { name, ok: response.ok, detail: response.ok ? 'reachable (read only)' : `HTTP ${response.status}` };
    } catch { return { name, ok: false, detail: 'unreachable or timed out' }; }
  };
  const nessie = env.NESSIE_API_KEY && env.NESSIE_ACCOUNT_ID
    ? `https://prod-api.nessieisreal.com/accounts/${encodeURIComponent(env.NESSIE_ACCOUNT_ID)}?key=${encodeURIComponent(env.NESSIE_API_KEY)}` : undefined;
  return [
    ...environmentRows(status, options.hostRows),
    { name: 'Web + seats', ok: status.workersHealthy !== false, detail: status.workersHealthy === false ? 'worker stopped' : 'web responding; shared-process seats' },
    { name: 'SpacetimeDB', ok: status.stateStore === 'spacetime', detail: status.stateStore === 'memory' ? 'unused: process-local memory mode' : 'adapter connected' },
    ...(options.hostRows ?? [await probe('GX10 router', `${(env.GX10_BASE_URL || 'http://100.117.44.20:11434/v1').replace(/\/$/, '')}/models`, 'not configured')]),
    ...(!options.hostRows ? [{ name: 'Cartesia key', ok: !!env.CARTESIA_API_KEY, detail: env.CARTESIA_API_KEY ? 'present; not a call-readiness test' : 'missing' }] : []),
    { name: 'Voice relay', ok: status.voice, detail: status.voice ? 'running; no call placed' : 'disabled or not configured' },
    status.attackDemo ?? { name: 'Attack demo', ok: false, detail: 'no supervisor observation' },
    ...(options.hostRows ? [] : [await probe('Nessie', nessie, 'key/account missing; rehearsal bank is mock')]),
    await probe('Tunnel', status.tunnelUrl ? `${status.tunnelUrl}/__demo/ping` : undefined, 'disabled'),
    { name: status.live ? 'LLM control' : 'LLM OFF', ok: status.live ? status.llmEnabled : !status.llmEnabled, detail: status.llmEnabled ? 'ON; model calls allowed' : 'OFF; code paths remain active' },
    ...(options.hostRows ? [] : [{ name: 'Cloud fallback', ok: false, detail: 'unverified; no web-host inference receipt' }]),
  ];
}
