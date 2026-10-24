import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CrsClient, CRS_CACHE_MAX_AGE_MS, isCrsOutage, CrsError } from './index';
import { FileCrsEvidenceCache, MemoryCrsEvidenceCache } from './cache';
import { CRS_CALHACKS_SANDBOX, createCrsClientFromEnv, crsSandboxFixtureFetch } from './sandbox';

type Mode = 'up' | 'network' | 503 | 429 | 400 | 'garbage';
function sandbox() {
  const state = { mode: 'up' as Mode, now: Date.parse('2026-10-24T13:05:00Z') };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (state.mode === 'network') throw new TypeError('fetch failed');
    if (typeof state.mode === 'number') return new Response('{}', { status: state.mode });
    if (state.mode === 'garbage') return new Response('not json');
    return crsSandboxFixtureFetch(input, init);
  };
  return { state, fetch };
}
const client = (s: ReturnType<typeof sandbox>, cache = new MemoryCrsEvidenceCache()) =>
  new CrsClient({ ...CRS_CALHACKS_SANDBOX, username: 'u', password: 'p', fetch: s.fetch, cache, now: () => s.state.now });

describe('CRS outage fallback (spec 6.3)', () => {
  it.each(['network', 503, 429] as const)('serves the last good evidence, labelled cached, when CRS is down (%s)', async mode => {
    const s = sandbox();
    const crs = client(s);
    const live = await crs.getPublicRecords(7);
    s.state.mode = mode;
    const cached = await crs.getPublicRecords(7);
    expect(cached).toMatchObject({ source: 'crs_sandbox', cached: true, summary: live.summary, responseHash: live.responseHash, checkedAt: live.checkedAt });
    expect(cached.label).toMatch(/^SANDBOX: test identity #7 \(cached at \d\d:\d\d UTC\)$/);
    expect(live.cached).toBeUndefined();
  });

  it.each([400, 'garbage'] as const)('does not hide a non-outage failure (%s)', async mode => {
    const s = sandbox();
    const crs = client(s);
    await crs.getFraudRisk(13);
    s.state.mode = mode;
    await expect(crs.getFraudRisk(13)).rejects.toBeInstanceOf(CrsError);
  });

  it('needs a cached row for that product and identity, younger than the age limit', async () => {
    const s = sandbox();
    const crs = client(s);
    await crs.getPublicRecords(7);
    s.state.mode = 'network';
    await expect(crs.getPublicRecords(6)).rejects.toMatchObject({ code: 'TRANSPORT' });
    await expect(crs.getFraudRisk(7)).rejects.toMatchObject({ code: 'TRANSPORT' });
    s.state.now += CRS_CACHE_MAX_AGE_MS + 1;
    await expect(crs.getPublicRecords(7)).rejects.toMatchObject({ code: 'TRANSPORT' });
  });

  it('falls back when CRS is down at the very first login, and recovers without latching AUTH', async () => {
    const s = sandbox();
    const cache = new MemoryCrsEvidenceCache();
    await client(s, cache).getPublicRecords(7);
    s.state.mode = 'network';
    const fresh = client(s, cache);
    expect((await fresh.getPublicRecords(7)).cached).toBe(true);
    s.state.mode = 'up';
    expect((await fresh.getPublicRecords(7)).cached).toBeUndefined();
  });

  it('still latches a rejected login (401) and never falls back for it', async () => {
    const s = sandbox();
    const cache = new MemoryCrsEvidenceCache();
    await client(s, cache).getPublicRecords(7);
    s.state.mode = 400;
    const fresh = client(s, cache);
    await expect(fresh.getPublicRecords(7)).rejects.toMatchObject({ code: 'AUTH' });
    s.state.mode = 'up';
    await expect(fresh.getPublicRecords(7)).rejects.toMatchObject({ code: 'AUTH' });
  });

  it('never caches fixture evidence', async () => {
    const cache = new MemoryCrsEvidenceCache();
    const fixture = new CrsClient({ ...CRS_CALHACKS_SANDBOX, username: 'f', password: 'f', fetch: crsSandboxFixtureFetch, fixture: true, cache });
    await fixture.getPublicRecords(7);
    expect(await cache.get('publicRecords:7')).toBeUndefined();
  });

  it('classifies outages', () => {
    expect([new CrsError('TRANSPORT'), new CrsError('HTTP', 502), new CrsError('HTTP', 429)].every(isCrsOutage)).toBe(true);
    expect([new CrsError('HTTP', 401), new CrsError('HTTP', 400), new CrsError('AUTH'), new CrsError('RESPONSE'), new CrsError('CONFIGURATION'), new Error('x')].some(isCrsOutage)).toBe(false);
  });
});

describe('FileCrsEvidenceCache', () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined; });

  it('survives a restart and holds only projected evidence', async () => {
    dir = mkdtempSync(join(tmpdir(), 'crs-cache-'));
    const path = join(dir, 'nested', 'crs-cache.json');
    const s = sandbox();
    await createCrsClientFromEnv({ CRS_USERNAME: 'u', CRS_PASSWORD: 'p', CRS_CACHE_FILE: path }, s.fetch)!.getPublicRecords(7);
    const stored = readFileSync(path, 'utf8');
    expect(stored).not.toMatch(/MARCUS|BELLAMY|666701007|token/);
    s.state.mode = 'network';
    const restarted = createCrsClientFromEnv({ CRS_USERNAME: 'u', CRS_PASSWORD: 'p', CRS_CACHE_FILE: path }, s.fetch)!;
    expect(await restarted.getPublicRecords(7)).toMatchObject({ cached: true, summary: { bankruptcies: 1 } });
  });

  it('ignores a corrupt file and foreign rows', async () => {
    dir = mkdtempSync(join(tmpdir(), 'crs-cache-'));
    const path = join(dir, 'crs-cache.json');
    writeFileSync(path, 'not json');
    expect(await new FileCrsEvidenceCache(path).get('publicRecords:7')).toBeUndefined();
    writeFileSync(path, JSON.stringify({ 'publicRecords:7': { source: 'crs_fixture', label: 'FAKE' } }));
    expect(await new FileCrsEvidenceCache(path).get('publicRecords:7')).toBeUndefined();
  });
});
