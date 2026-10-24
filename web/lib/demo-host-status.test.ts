import { describe, expect, it, vi } from 'vitest';
vi.mock('./demo/services', () => ({ getDemoHostServices: () => null }));
import { createHostServiceSource, mapHostServices, type HostServices } from './demo-host-status';
import { RECEIPT_MAX_AGE_MS, type ServiceProbe, type ServiceStatusSnapshot } from './demo-probes';

const now = Date.parse('2026-10-24T15:00:00.000Z');
const started = now - 3600_000;
const p = (state: ServiceProbe['state'], evidence: string): ServiceProbe => ({ state, source: 'live', evidence, at: new Date(now).toISOString() });
const localSnapshot: ServiceStatusSnapshot = { checkedAt: new Date(now).toISOString(), services: {
  phone: p('unverified', 'No call receipt'), claude: p('verified', 'Route receipt local'), gx10: p('verified', 'GET /models · 2 models'),
  apify: p('verified', 'Run local'), policy: p('verified', 'Receipt'), spacetime: p('verified', 'Database reachable') } };
const fake: HostServices = { preCall: { status: 'not_prepared' }, model: { mode: 'OFF', cloud: 'missing' }, nessie: { mode: 'mock' },
  apify: { mode: 'FAKE', status: 'not_probed' }, crs: { mode: 'FAKE', status: 'not_probed', products: [], ofac: 'unavailable', businessCredit: 'unavailable' } };
const live: HostServices = { preCall: { status: 'ready' }, model: { mode: 'GX10_then_Anthropic', cloud: 'inference_observed' }, nessie: { mode: 'sandbox' },
  apify: { mode: 'live', status: 'complete', runId: 'run_AbC123' }, crs: { mode: 'sandbox', status: 'complete', products: [], ofac: 'unavailable', businessCredit: 'unavailable' } };
const source = (host: HostServices | null, local: ServiceStatusSnapshot | null = localSnapshot) => createHostServiceSource({
  readHost: () => host, local: { name: 'local', read: async () => local }, now: () => now, hostStartedAt: () => started });

describe('demo host service source', () => {
  it('without a host contract returns local probes untouched', async () => {
    expect(await source(null).read()).toBe(localSnapshot);
  });
  it('keeps the first-run Checking state while local probes are pending', async () => {
    expect(await source(live, null).read()).toBeNull();
  });
  it('rehearsal host reports FAKE adapters as simulated and never Verified', async () => {
    const snap = (await source(fake).read())!;
    expect(snap.services.claude).toMatchObject({ state: 'disabled' });
    expect(snap.services.apify).toMatchObject({ state: 'simulated', evidence: 'FAKE rehearsal adapter' });
    expect(snap.services.nessie).toMatchObject({ state: 'simulated' });
    expect(snap.services.crs).toMatchObject({ state: 'simulated', evidence: 'FAKE fixture client' });
    // Local probes still own GX10, SpacetimeDB, phone and policy.
    for (const id of ['gx10', 'spacetime', 'phone', 'policy'] as const) expect(snap.services[id]).toBe(localSnapshot.services[id]);
  });
  it('live host evidence is Verified and dated no later than host start', async () => {
    const snap = (await source(live).read())!;
    const since = new Date(started).toISOString();
    expect(snap.services.claude).toEqual({ state: 'verified', source: 'receipt', evidence: 'Host pre-call inference validated', at: since });
    expect(snap.services.apify).toEqual({ state: 'verified', source: 'receipt', evidence: 'Run run_AbC123', at: since });
    expect(snap.services.crs).toMatchObject({ state: 'verified', at: since });
    expect(snap.services.nessie).toMatchObject({ state: 'unverified' });
  });
  it('does not claim Verified without fresh evidence', () => {
    const configured = mapHostServices({ ...live, model: { mode: 'GX10_then_Anthropic', cloud: 'configured_not_probed' },
      apify: { mode: 'live', status: 'pending' }, crs: { ...live.crs, status: 'unavailable' } }, now, started);
    expect(configured.claude.state).toBe('unverified');
    expect(configured.apify.state).toBe('unverified');
    expect(configured.crs.state).toBe('unreachable');
    expect(mapHostServices(live, now, now - RECEIPT_MAX_AGE_MS - 1).apify.state).toBe('unverified');
    expect(mapHostServices({ ...live, apify: { mode: 'live', status: 'complete', runId: 'bad id/../x' } }, now, started).apify.state).toBe('unverified');
    expect(mapHostServices({ ...live, apify: { mode: 'live', status: 'unavailable_no_retry' } }, now, started).apify.state).toBe('unreachable');
  });
  it('a throwing host read falls back to local probes', async () => {
    const snap = await createHostServiceSource({ readHost: () => { throw new Error('boom'); },
      local: { name: 'local', read: async () => localSnapshot }, now: () => now, hostStartedAt: () => started }).read();
    expect(snap).toBe(localSnapshot);
  });
});
