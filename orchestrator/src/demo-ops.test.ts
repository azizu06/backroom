import { describe, expect, it } from 'vitest';
import { probeAttackDemo, probeDependencies } from '../../tools/demo/health';

describe('demo dependency health', () => {
  it('reports actual OFF and missing integrations without any live network', async () => {
    const calls: string[] = [];
    const rows = await probeDependencies({ env: {}, status: { llmEnabled: false, stateStore: 'memory', voice: false },
      fetch: async url => { calls.push(String(url)); throw new Error('secret provider detail'); } });
    expect(rows.find(row => row.name === 'LLM OFF')).toMatchObject({ ok: true, detail: 'OFF; code paths remain active' });
    expect(rows.find(row => row.name === 'SpacetimeDB')).toMatchObject({ ok: false });
    expect(rows.find(row => row.name === 'Cartesia key')).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain('secret provider detail');
  });

  it('shows a red row with only missing/defaulted required variable names', async () => {
    const rows = await probeDependencies({ env: {}, status: { llmEnabled: false, stateStore: 'memory', voice: false,
      envChecks: [{ process: 'web + seats', missing: ['APIFY_TOKEN'], defaulted: ['ANTHROPIC_MODEL'] }] } });
    expect(rows[0]).toEqual({ name: 'Required env (web + seats)', ok: false,
      detail: 'missing: APIFY_TOKEN; defaulted: ANTHROPIC_MODEL' });
  });
});

it('bounded live probes hide credential URLs and require successful responses', async () => {
  const rows = await probeDependencies({ env: { CARTESIA_API_KEY: 'private-cartesia', NESSIE_API_KEY: 'private-nessie',
    NESSIE_ACCOUNT_ID: 'account', DEMO_PUBLIC_URL: 'https://demo.example' }, live: true,
    status: { llmEnabled: true, stateStore: 'memory', voice: true, tunnelUrl: 'https://demo.example' },
    fetch: async url => String(url).includes('nessie') ? new Response('', { status: 403 }) : new Response('{}') });
  expect(rows.find(row => row.name === 'Nessie')).toMatchObject({ ok: false, detail: 'HTTP 403' });
  expect(rows.find(row => row.name === 'Tunnel')).toMatchObject({ ok: true });
  expect(rows.find(row => row.name === 'LLM OFF')).toMatchObject({ ok: false });
  expect(JSON.stringify(rows)).not.toContain('private-');
});

it('uses web host service observations even if the health CLI has different credentials', async () => {
  const hostRows = [{ name: 'Nessie', ok: false, detail: 'unused: web host uses mock bank' },
    { name: 'CRS', ok: false, detail: 'FAKE fixture client' }];
  const http = async () => { throw new Error('must not probe CLI credentials'); };
  const rows = await probeDependencies({ env: { NESSIE_API_KEY: 'wrong-process-key', NESSIE_ACCOUNT_ID: 'wrong-process-account' },
    status: { llmEnabled: false, stateStore: 'memory', voice: false }, live: true, hostRows, fetch: http });
  expect(rows.filter(row => row.name === 'Nessie')).toEqual([hostRows[0]]);
  expect(rows).toContainEqual(hostRows[1]);
  expect(rows.some(row => row.name === 'Cloud fallback')).toBe(false);
});

it('probes the private attack server with a bearer and never reads or reports its body', async () => {
  let cancelled = false;
  const attackDemo = await probeAttackDemo({ ATTACK_DEMO_BASE_URL: 'http://127.0.0.1:48970', TOOL_GATEWAY_SECRET: 'private-gateway' },
    async (url, init) => {
      expect(String(url)).toBe('http://127.0.0.1:48970/api/attack-demo');
      expect(init).toMatchObject({ headers: { authorization: 'Bearer private-gateway' }, redirect: 'error' });
      expect(init?.method).toBeUndefined(); // GET; no analysis or inference.
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return { ok: true, body: { cancel: async () => { cancelled = true; } },
        json: () => { throw new Error('response body must not be read'); } } as unknown as Response;
    });
  expect(attackDemo).toEqual({ name: 'Attack demo', ok: true, detail: 'reachable (mock)' });
  expect(cancelled).toBe(true);
  const rows = await probeDependencies({ env: {}, status: { llmEnabled: false, stateStore: 'memory', voice: false, attackDemo } });
  expect(rows).toContainEqual(attackDemo);
  expect(JSON.stringify(rows)).not.toContain('private-gateway');
});

it('reports attack refusal and failure without exposing upstream details or claiming mock for live opt-in', async () => {
  const env = { ATTACK_DEMO_BASE_URL: 'http://127.0.0.1:48970', TOOL_GATEWAY_SECRET: 'private-gateway' };
  expect(await probeAttackDemo(env, async () => new Response('private error', { status: 401 })))
    .toEqual({ name: 'Attack demo', ok: false, detail: 'HTTP 401' });
  expect(await probeAttackDemo(env, async () => { throw new Error('private error'); }))
    .toEqual({ name: 'Attack demo', ok: false, detail: 'unreachable or timed out' });
  expect(await probeAttackDemo({ ...env, ATTACK_DEMO_LIVE: '1' }, async () => new Response('')))
    .toEqual({ name: 'Attack demo', ok: true, detail: 'reachable (live enabled)' });
});
