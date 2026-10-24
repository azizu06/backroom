import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDemoProbes, localProbeSource, PROBE_CACHE_TTL_MS, PROBE_TIMEOUT_MS, probeServices, readServiceStatus, resetDemoProbesForTest,
  setServiceStatusSource, type ProbeDeps,
} from './demo-probes';

const NOW = Date.parse('2026-10-24T14:00:00.000Z');
const GX10 = 'http://gx10.internal.example:11434/v1/';
const STDB = 'wss://stdb.internal.example/';
const CREDENTIAL = 'cred-value-do-not-leak-1234';
const HOUR = 3600_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const anthropicReceipt = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  startedAt: ago(4 * HOUR), passed: true, provider: 'anthropic',
  requests: [{ requestId: 'req_failed1', status: 500 }, { requestId: 'req_good1', status: 200 }], ...overrides,
});
const apifyReceipt = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  measuredAt: ago(5 * HOUR), runId: 'runABC123', status: 'complete', platform: { status: 'SUCCEEDED' }, ...overrides,
});
const policyReceipt = (measuredAt: string, deny = 'FEES_NON_WAIVABLE') => JSON.stringify({
  measuredAt,
  collection: {
    denial: { kind: 'DENY', rule_ids: [deny], audit_id: 'a-1' },
    allowed: { kind: 'ALLOW', rule_ids: ['IN_BADGE'], audit_id: 'a-2' },
  },
});
const voiceLine = (at: string, status: number, path = '/api/voice/webhook') => JSON.stringify({
  at, path, status, server_ms: 3, body: { call_id: 'call_secretish_999', turn: 1 }, result: { speak: '+1[REDACTED_NUMBER]' },
});

function baseFiles(): Record<string, string> {
  return {
    '/ev/anthropic/live-a.json': anthropicReceipt(),
    '/ev/anthropic/live-b.json': anthropicReceipt({ startedAt: ago(2 * HOUR), passed: false, requests: [{ requestId: 'req_newer_failed', status: 200 }] }),
    '/ev/apify/live-run.json': apifyReceipt(),
    '/ev/live-run/old/receipt.json': policyReceipt(ago(10 * HOUR), 'OLD_RULE'),
    '/ev/live-run/new/receipt.json': policyReceipt(ago(3 * HOUR)),
    '/voice/a.jsonl': [voiceLine(ago(2 * HOUR), 200), voiceLine(ago(HOUR), 500), '{not json', ''].join('\n'),
  };
}
const dirs: Record<string, string[]> = {
  '/ev/anthropic': ['README.md', 'live-a.json', 'live-b.json'],
  '/ev/live-run': ['README.md', 'old', 'new'],
};

function deps(overrides: Partial<ProbeDeps> & { files?: Record<string, string> } = {}) {
  const files = overrides.files ?? baseFiles();
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }), { status: 200 });
    return new Response('{}', { status: 200 });
  });
  const value: ProbeDeps = {
    env: {
      GX10_BASE_URL: GX10, ANTHROPIC_API_KEY: CREDENTIAL, STATE_STORE: 'spacetime',
      SPACETIMEDB_URI: STDB, SPACETIMEDB_DATABASE: 'backroom db', SPACETIMEDB_TOKEN: CREDENTIAL,
    },
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => NOW,
    readText: async path => files[path] ?? null,
    listDir: async path => dirs[path] ?? [],
    evidenceRoot: '/ev',
    voiceEvidencePaths: ['/voice/a.jsonl', '/voice/missing.jsonl'],
    ...overrides,
  };
  return { deps: value, fetch: (overrides.fetch ?? fetch) as unknown as ReturnType<typeof vi.fn> };
}
const env = (patch: Record<string, string | undefined>) => ({ ...deps().deps.env, ...patch });
const urls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.map(call => String(call[0]));

function expectNoLeak(result: unknown) {
  const text = JSON.stringify(result);
  for (const value of [GX10, 'gx10.internal.example', STDB, 'stdb.internal.example', CREDENTIAL, 'call_secretish_999', '/api/voice', 'REDACTED']) {
    expect(text).not.toContain(value);
  }
  expect(text).not.toMatch(/key|token|secret|password|https?:/i);
}

describe('probeServices', () => {
  it('verifies every service from live probes and fresh receipts without leaking', async () => {
    const { deps: d, fetch } = deps();
    const result = await probeServices(d);
    expect(result).toEqual({
      gx10: { state: 'verified', source: 'live', evidence: 'GET /v1/models · 3 models', at: new Date(NOW).toISOString() },
      claude: { state: 'verified', source: 'receipt', evidence: 'Route receipt req_good1', at: ago(4 * HOUR) },
      apify: { state: 'verified', source: 'receipt', evidence: 'Run runABC123', at: ago(5 * HOUR) },
      policy: { state: 'verified', source: 'receipt', evidence: 'Receipt: DENY FEES_NON_WAIVABLE, ALLOW IN_BADGE', at: ago(3 * HOUR) },
      phone: { state: 'verified', source: 'receipt', evidence: 'Call webhook HTTP 200', at: ago(2 * HOUR) },
      spacetime: { state: 'verified', source: 'live', evidence: 'Database reachable', at: new Date(NOW).toISOString() },
    });
    expect(urls(fetch).sort()).toEqual(['http://gx10.internal.example:11434/v1/models', 'https://stdb.internal.example/v1/database/backroom%20db']);
    for (const [, init] of fetch.mock.calls as [string, RequestInit][]) {
      expect(init.method).toBe('GET');
      expect(init.body).toBeUndefined();
      expect(init.headers).toBeUndefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(urls(fetch).some(url => /anthropic|claude/i.test(url))).toBe(false);
    expectNoLeak(result);
  });

  describe('gx10', () => {
    it('reports HTTP failures as unreachable', async () => {
      const fetch = vi.fn(async () => new Response('down', { status: 503 }));
      const { gx10 } = await probeServices(deps({ fetch: fetch as unknown as typeof globalThis.fetch }).deps);
      expect(gx10).toEqual({ state: 'unreachable', source: 'live', evidence: 'HTTP 503', at: new Date(NOW).toISOString() });
    });
    it('reports timeouts as unreachable', async () => {
      const fetch = vi.fn(async () => { throw new DOMException('The operation timed out.', 'TimeoutError'); });
      const result = await probeServices(deps({ fetch: fetch as unknown as typeof globalThis.fetch }).deps);
      expect(result.gx10).toMatchObject({ state: 'unreachable', evidence: 'Timed out' });
      expect(result.spacetime).toMatchObject({ state: 'unreachable', evidence: 'Timed out' });
      expect(PROBE_TIMEOUT_MS).toBe(2000);
      expectNoLeak(result);
    });
    it('reports other errors as connection failures without the error message', async () => {
      const fetch = vi.fn(async () => { throw new TypeError(`fetch failed ${GX10}`); });
      const result = await probeServices(deps({ fetch: fetch as unknown as typeof globalThis.fetch }).deps);
      expect(result.gx10).toMatchObject({ state: 'unreachable', evidence: 'Connection failed' });
      expectNoLeak(result);
    });
    it('rejects a 2xx response without a model list', async () => {
      const fetch = vi.fn(async () => new Response('{"error":"nope"}', { status: 200 }));
      expect((await probeServices(deps({ fetch: fetch as unknown as typeof globalThis.fetch }).deps)).gx10).toMatchObject({ state: 'unreachable' });
    });
    it('honours the disable switch without probing', async () => {
      const { deps: d, fetch } = deps();
      const { gx10 } = await probeServices({ ...d, env: env({ GX10_ENABLED: 'false' }) });
      expect(gx10).toEqual({ state: 'disabled', source: 'config', evidence: 'Disabled by config', at: null });
      expect(urls(fetch).some(url => url.endsWith('/models'))).toBe(false);
    });
    it('is unverified when not configured', async () => {
      const { deps: d } = deps();
      expect((await probeServices({ ...d, env: env({ GX10_BASE_URL: undefined }) })).gx10).toEqual({ state: 'unverified', source: 'config', evidence: 'Not configured', at: null });
    });
  });

  describe('claude', () => {
    it('never verifies without a credential in this process', async () => {
      const { deps: d, fetch } = deps();
      const result = await probeServices({ ...d, env: env({ ANTHROPIC_API_KEY: '  ' }) });
      expect(result.claude).toEqual({ state: 'unverified', source: 'config', evidence: 'No cloud credential in this process', at: null });
      expect(urls(fetch).some(url => /anthropic/i.test(url))).toBe(false);
      expectNoLeak(result);
    });
    it('rejects stale receipts', async () => {
      const files = { ...baseFiles(), '/ev/anthropic/live-a.json': anthropicReceipt({ startedAt: ago(73 * HOUR) }) };
      const { deps: d, fetch } = deps({ files });
      expect((await probeServices(d)).claude).toMatchObject({ state: 'unverified', evidence: 'No fresh route receipt', at: null });
      expect(urls(fetch).some(url => /anthropic/i.test(url))).toBe(false);
    });
    it('honours DEMO_RECEIPT_MAX_AGE_HOURS', async () => {
      const { deps: d } = deps();
      expect((await probeServices({ ...d, env: env({ DEMO_RECEIPT_MAX_AGE_HOURS: '1' }) })).claude).toMatchObject({ state: 'unverified' });
    });
    it('ignores failed receipts, wrong providers and receipts without a 200 request id', async () => {
      const files = {
        ...baseFiles(),
        '/ev/anthropic/live-a.json': anthropicReceipt({ passed: false }),
        '/ev/anthropic/live-b.json': anthropicReceipt({ provider: 'openrouter' }),
        '/ev/anthropic/live-c.json': anthropicReceipt({ requests: [{ status: 200 }, { requestId: 'req_x', status: 429 }] }),
      };
      const { deps: d, fetch } = deps({ files, listDir: async () => ['live-a.json', 'live-b.json', 'live-c.json'] });
      expect((await probeServices(d)).claude).toMatchObject({ state: 'unverified', evidence: 'No fresh route receipt' });
      expect(urls(fetch).some(url => /anthropic/i.test(url))).toBe(false);
    });
  });

  describe('apify', () => {
    it('uses the newest valid receipt, including a rehearsal folder apify-live.json without platform readback', async () => {
      const files = { ...baseFiles(), '/ev/test-v1/apify-live.json': apifyReceipt({ measuredAt: ago(HOUR), runId: 'runNEWER1', platform: undefined, chainValid: true }),
        '/ev/broken/apify-live.json': apifyReceipt({ measuredAt: ago(1000), runId: 'runBROKEN', chainValid: false }) };
      const listDir = async (path: string) => path === '/ev' ? ['apify', 'test-v1', 'broken', 'README.md'] : dirs[path] ?? [];
      expect((await probeServices({ ...deps({ files }).deps, listDir })).apify)
        .toEqual({ state: 'verified', source: 'receipt', evidence: 'Run runNEWER1', at: ago(HOUR) });
    });
    it('rejects stale run receipts', async () => {
      const { deps: d } = deps({ files: { ...baseFiles(), '/ev/apify/live-run.json': apifyReceipt({ measuredAt: ago(80 * HOUR) }) } });
      expect((await probeServices(d)).apify).toEqual({ state: 'unverified', source: 'receipt', evidence: 'No fresh run receipt', at: null });
    });
    it('rejects missing or unsuccessful runs', async () => {
      const files = baseFiles();
      delete files['/ev/apify/live-run.json'];
      expect((await probeServices(deps({ files }).deps)).apify).toMatchObject({ state: 'unverified', evidence: 'No fresh run receipt' });
      const failed = { ...baseFiles(), '/ev/apify/live-run.json': apifyReceipt({ platform: { status: 'FAILED' } }) };
      expect((await probeServices(deps({ files: failed }).deps)).apify).toMatchObject({ state: 'unverified' });
      expect((await probeServices({ ...deps().deps, evidenceRoot: null })).apify).toMatchObject({ state: 'unverified' });
    });
  });

  describe('policy', () => {
    it('is unverified when no decision receipt exists', async () => {
      const { deps: d } = deps({ listDir: async () => [] });
      expect((await probeServices(d)).policy).toEqual({ state: 'unverified', source: 'receipt', evidence: 'No fresh policy receipt', at: null });
    });
    it('ignores receipts without a DENY audit id', async () => {
      const bad = JSON.stringify({ measuredAt: ago(HOUR), collection: { denial: { kind: 'DENY', rule_ids: ['X'] }, allowed: { kind: 'ALLOW', rule_ids: ['Y'] } } });
      const { deps: d } = deps({ files: { '/ev/live-run/new/receipt.json': bad }, listDir: async () => ['new'] });
      expect((await probeServices(d)).policy).toMatchObject({ state: 'unverified' });
    });
  });

  describe('phone', () => {
    it('is unverified without a call receipt', async () => {
      const { deps: d } = deps({ voiceEvidencePaths: ['/voice/missing.jsonl'] });
      expect((await probeServices(d)).phone).toEqual({ state: 'unverified', source: 'receipt', evidence: 'No call receipt in this process', at: null });
    });
    it('ignores non-2xx, non-voice and stale lines', async () => {
      const files = { '/voice/a.jsonl': [voiceLine(ago(HOUR), 500), voiceLine(ago(HOUR), 200, '/api/other'), voiceLine(ago(100 * HOUR), 200)].join('\n') };
      const { deps: d } = deps({ files });
      expect((await probeServices(d)).phone).toMatchObject({ state: 'unverified', evidence: 'No call receipt in this process' });
    });
  });

  describe('spacetime', () => {
    it('reports the in-memory store as simulated without probing', async () => {
      const { deps: d, fetch } = deps();
      const result = await probeServices({ ...d, env: env({ STATE_STORE: undefined }) });
      expect(result.spacetime).toEqual({ state: 'simulated', source: 'config', evidence: 'In-memory state fixture', at: null });
      expect(urls(fetch).some(url => url.includes('/v1/database/'))).toBe(false);
    });
    it('converts ws:// to http:// and sends no Authorization header', async () => {
      const { deps: d, fetch } = deps();
      const result = await probeServices({ ...d, env: env({ SPACETIMEDB_URI: 'ws://127.0.0.1:3000', SPACETIMEDB_DATABASE: 'backroom' }) });
      expect(result.spacetime).toMatchObject({ state: 'verified', source: 'live', evidence: 'Database reachable' });
      const call = (fetch.mock.calls as [string, RequestInit][]).find(([url]) => url.includes('/v1/database/'))!;
      expect(call[0]).toBe('http://127.0.0.1:3000/v1/database/backroom');
      expect(new Headers(call[1].headers).has('Authorization')).toBe(false);
      expectNoLeak(result);
    });
    it('reports HTTP failures as unreachable', async () => {
      const fetch = vi.fn(async (input: RequestInfo | URL) => String(input).includes('/v1/database/')
        ? new Response('', { status: 404 }) : new Response('{"data":[]}', { status: 200 }));
      const result = await probeServices(deps({ fetch: fetch as unknown as typeof globalThis.fetch }).deps);
      expect(result.spacetime).toEqual({ state: 'unreachable', source: 'live', evidence: 'HTTP 404', at: new Date(NOW).toISOString() });
      expect(result.gx10).toMatchObject({ state: 'verified', evidence: 'GET /v1/models · 0 models' });
    });
    it('is unverified when not configured', async () => {
      const { deps: d } = deps();
      expect((await probeServices({ ...d, env: env({ SPACETIMEDB_DATABASE: undefined }) })).spacetime).toEqual({ state: 'unverified', source: 'config', evidence: 'Not configured', at: null });
    });
  });

  it('never throws when a dependency throws', async () => {
    const { deps: d } = deps();
    const broken: ProbeDeps = { ...d, readText: async () => { throw new Error('disk on fire'); }, listDir: async () => { throw new Error('nope'); } };
    const result = await probeServices(broken);
    for (const id of ['phone', 'claude', 'apify', 'policy'] as const) expect(result[id]).toMatchObject({ state: 'unverified', evidence: 'Probe failed' });
    expect(result.gx10.state).toBe('verified');
  });
});

describe('getDemoProbes cache', () => {
  beforeEach(() => resetDemoProbesForTest());
  afterEach(() => { vi.useRealTimers(); resetDemoProbesForTest(); });

  it('reuses a fresh snapshot, then serves stale while refreshing once in the background', async () => {
    let now = NOW;
    const { deps: d, fetch } = deps({ now: () => now });
    const first = await getDemoProbes(d);
    expect(first?.services.gx10.state).toBe('verified');
    expect(fetch).toHaveBeenCalledTimes(2);
    now += PROBE_CACHE_TTL_MS - 1;
    expect(await getDemoProbes(d)).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(2);

    now += 2;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    fetch.mockImplementation(async () => { await gate; return new Response('{"data":[]}', { status: 200 }); });
    expect(await getDemoProbes(d)).toBe(first);
    expect(await getDemoProbes(d)).toBe(first);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    release();
    await vi.waitFor(async () => expect(await getDemoProbes(d)).not.toBe(first));
    expect(fetch).toHaveBeenCalledTimes(4);
    expect((await getDemoProbes(d))?.services.gx10.evidence).toBe('GET /v1/models · 0 models');
  });

  it('shares one run between concurrent first callers', async () => {
    const { deps: d, fetch } = deps();
    const [a, b, c] = await Promise.all([getDemoProbes(d), getDemoProbes(d), getDemoProbes(d)]);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns null instead of waiting past 2500 ms for the first run, and the run still fills the cache', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetch = vi.fn(async () => { await gate; return new Response('{"data":[]}', { status: 200 }); });
    const { deps: d } = deps({ fetch: fetch as unknown as typeof globalThis.fetch });
    const pending = getDemoProbes(d);
    await vi.advanceTimersByTimeAsync(2499);
    let settled = false;
    void pending.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
    release();
    vi.useRealTimers();
    await vi.waitFor(async () => expect((await getDemoProbes(d))?.services.gx10.state).toBe('verified'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('looks up the global fetch at call time by default', async () => {
    const fetch = vi.fn(async () => new Response('{"data":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    try {
      const { deps: d } = deps();
      const { fetch: _ignored, ...rest } = d;
      const result = await getDemoProbes(rest);
      expect(result?.services.gx10.state).toBe('verified');
      expect(fetch).toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('service status source seam', () => {
  afterEach(() => { setServiceStatusSource(null); resetDemoProbesForTest(); });

  it('uses local probes by default', () => {
    expect(localProbeSource.name).toBe('local-probes');
  });

  it('lets a host source replace local probes', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    try {
      const snapshot = { checkedAt: new Date(NOW).toISOString(), services: { policy: { state: 'verified' as const, source: 'live' as const, evidence: 'Host contract', at: new Date(NOW).toISOString() } } };
      const read = vi.fn(async () => snapshot);
      setServiceStatusSource({ name: 'host', read });
      expect(await readServiceStatus()).toBe(snapshot);
      expect(read).toHaveBeenCalledTimes(1);
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('turns a throwing source into null', async () => {
    setServiceStatusSource({ name: 'broken', read: async () => { throw new Error(`boom ${GX10}`); } });
    await expect(readServiceStatus()).resolves.toBeNull();
    setServiceStatusSource({ name: 'sync-broken', read: () => { throw new Error('sync boom'); } });
    await expect(readServiceStatus()).resolves.toBeNull();
  });

  it('restores local probes when reset with null', async () => {
    const read = vi.fn(async () => null);
    setServiceStatusSource({ name: 'host', read });
    setServiceStatusSource(null);
    const spy = vi.spyOn(localProbeSource, 'read').mockResolvedValue(null);
    try {
      await readServiceStatus();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(read).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});
