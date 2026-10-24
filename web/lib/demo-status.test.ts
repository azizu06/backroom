import { afterEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({
  llmEnabled: false,
  health: null as null | { localEnabled: boolean; localAvailable: boolean; checkedAt: string | null; privateField?: string },
  probes: null as null | { checkedAt: string; services: Record<string, unknown> },
}));
vi.mock('@backroom/orchestrator', () => ({
  getStateStore: () => ({ llmEnabled: runtime.llmEnabled }),
  getRouterHealth: () => runtime.health,
}));
// The route reads through the service-status seam; both entry points return the mocked probe snapshot.
vi.mock('../lib/demo-probes', () => ({
  getDemoProbes: vi.fn(async () => runtime.probes),
  readServiceStatus: vi.fn(async () => runtime.probes),
}));
import { GET } from '../app/api/demo-status/route';
import { readServiceStatus } from './demo-probes';

const realIds = ['phone', 'claude', 'gx10', 'apify', 'policy', 'spacetime'];
const at = '2026-10-24T13:00:00.000Z';
const probes = () => ({
  checkedAt: at,
  services: Object.fromEntries(realIds.map(id => [id, { state: 'verified', source: 'receipt', evidence: `Evidence ${id}`, at }])),
});
afterEach(() => { vi.unstubAllGlobals(); runtime.probes = null; runtime.llmEnabled = false; runtime.health = null; });

it('reads OFF with no network requests and no secret or control exposure', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const response = await GET();
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const body = await response.json();
  expect(body).toEqual({ measuredAt: expect.any(String), llmEnabled: false, notProbed: [], gx10: null, probesCheckedAt: null, services: {} });
  expect(JSON.stringify(body)).not.toMatch(/https?:|key|token|secret|password/i);
  expect(fetch).not.toHaveBeenCalled();
  expect(readServiceStatus).toHaveBeenCalled();
});

it('publishes probe results and leaves nothing unprobed when probes exist', async () => {
  runtime.probes = probes();
  const response = await GET();
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const body = await response.json();
  expect(body.probesCheckedAt).toBe(at);
  expect(body.notProbed).toEqual([]);
  expect(Object.keys(body.services).sort()).toEqual([...realIds].sort());
  expect(body.services.policy).toEqual({ state: 'verified', source: 'receipt', evidence: 'Evidence policy', at });
});

it('lists services absent from a partial snapshot as not probed', async () => {
  runtime.probes = { checkedAt: at, services: { gx10: { state: 'unreachable', source: 'live', evidence: 'Timed out', at } } };
  const body = await (await GET()).json();
  expect(body.notProbed).toEqual(['phone', 'claude', 'apify', 'policy', 'spacetime']);
  expect(body.services).toEqual({ gx10: { state: 'unreachable', source: 'live', evidence: 'Timed out', at } });
});

it('allowlists probe fields and drops malformed entries so no secrets leak', async () => {
  runtime.probes = {
    checkedAt: at,
    services: {
      gx10: { state: 'verified', source: 'live', evidence: 'GET /models · 2 models', at, url: 'http://100.0.0.1:11434/v1', apiKey: 'sk-private' },
      claude: { state: 'online', source: 'live', evidence: 'bogus', at },
      unknown: { state: 'verified', source: 'live', evidence: 'x', at },
    },
  };
  const body = await (await GET()).json();
  expect(body.services).toEqual({ gx10: { state: 'verified', source: 'live', evidence: 'GET /models · 2 models', at } });
  expect(body.notProbed).toContain('claude');
  expect(body.notProbed).not.toContain('gx10');
  expect(JSON.stringify(body)).not.toMatch(/https?:|key|token|secret|password|sk-private|100\.0\.0\.1/i);
});

it('publishes only the health allowlist', async () => {
  runtime.llmEnabled = true;
  runtime.health = { localEnabled: true, localAvailable: false, checkedAt: '2026-10-24T08:00:00.000Z', privateField: 'must-not-leak' };
  expect(await (await GET()).json()).toEqual({ measuredAt: expect.any(String), llmEnabled: true, notProbed: expect.any(Array), probesCheckedAt: null, services: {}, gx10: {
    localEnabled: true, localAvailable: false, checkedAt: '2026-10-24T08:00:00.000Z',
  } });
});

it('never labels a service both probed and not probed', async () => {
  runtime.probes = probes();
  const { notProbed, services } = await (await GET()).json() as { notProbed: string[]; services: Record<string, unknown> };
  for (const id of notProbed) expect(services[id]).toBeUndefined();
  expect([...notProbed, ...Object.keys(services)].sort()).toEqual([...realIds].sort());
});
