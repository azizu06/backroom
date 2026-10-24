import { describe, expect, it } from 'vitest';
import { BALANCE_CACHE_MAX_AGE_MS, MemoryBalanceDisplayCache, NessieClient, NessieError } from './index.js';

type Mode = 'up' | 'network' | 503 | 404 | 'negative' | 'garbled';
function bank() {
  const state = { mode: 'up' as Mode, now: Date.parse('2026-10-24T13:05:00Z') };
  const fetch: typeof globalThis.fetch = async input => {
    if (state.mode === 'network') throw new TypeError('fetch failed');
    if (typeof state.mode === 'number') return new Response('{}', { status: state.mode });
    if (state.mode === 'garbled') return new Response('not json', { status: 200 });
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/deposits')) return Response.json([{ _id: 'dep-1', status: 'completed', medium: 'balance', amount: 2475 }]);
    return Response.json({ _id: 'acct-1', balance: state.mode === 'negative' ? -5 : 10000 });
  };
  const cache = new MemoryBalanceDisplayCache();
  const client = new NessieClient({ apiKey: 'secret', claims: { claim: async () => true }, fetch, readAttempts: 1,
    displayCache: cache, now: () => state.now });
  return { state, client, cache };
}

describe('readBalanceDisplay outage fallback (spec 6.3)', () => {
  it.each(['network', 503] as const)('serves the last good figures, labelled cached, when Nessie is down (%s)', async mode => {
    const b = bank();
    const live = await b.client.readBalanceDisplay('acct-1');
    expect(live).toMatchObject({ cached: false, freshness: 'live', displayTotal: 12475 });
    b.state.mode = mode;
    const cached = await b.client.readBalanceDisplay('acct-1');
    expect(cached).toMatchObject({ cached: true, freshness: 'cached at 13:05 UTC', displayTotal: 12475, observedAt: live.observedAt });
  });

  it.each([404, 'negative', 'garbled'] as const)('does not hide a refusal or invalid bank data (%s)', async mode => {
    const b = bank();
    await b.client.readBalanceDisplay('acct-1');
    b.state.mode = mode;
    await expect(b.client.readBalanceDisplay('acct-1')).rejects.toBeInstanceOf(NessieError);
  });

  it('respects the age limit and needs a row for that account', async () => {
    const b = bank();
    await b.client.readBalanceDisplay('acct-1');
    b.state.mode = 'network';
    await expect(b.client.readBalanceDisplay('acct-2')).rejects.toMatchObject({ outage: true });
    b.state.now += BALANCE_CACHE_MAX_AGE_MS + 1;
    await expect(b.client.readBalanceDisplay('acct-1')).rejects.toMatchObject({ outage: true });
  });

  it('leaves the live read untouched, so health probes still report the outage', async () => {
    const b = bank();
    await b.client.readBalanceDisplay('acct-1');
    b.state.mode = 'network';
    await expect(b.client.readBalanceWithPostedDeposits('acct-1')).rejects.toMatchObject({ outage: true });
  });

  it('without a cache, an outage still throws', async () => {
    const b = bank();
    const plain = new NessieClient({ apiKey: 'secret', claims: { claim: async () => true }, readAttempts: 1,
      fetch: async () => { throw new TypeError('fetch failed'); } });
    await expect(plain.readBalanceDisplay('acct-1')).rejects.toMatchObject({ outage: true });
    expect(await b.cache.get('acct-1')).toBeUndefined();
  });

  it('an unreadable 200 body is invalid data, not an outage', async () => {
    const b = bank();
    await b.client.readBalanceDisplay('acct-1');
    b.state.mode = 'garbled';
    await expect(b.client.readBalanceDisplay('acct-1')).rejects.toMatchObject({ outage: false });
  });

  it('a throwing observer never turns a good read into a fallback', async () => {
    const b = bank();
    const watched = new NessieClient({ apiKey: 'secret', claims: { claim: async () => true }, readAttempts: 1, displayCache: b.cache,
      fetch: async input => { const path = new URL(String(input)).pathname;
        return Response.json(path.endsWith('/deposits') ? [] : { _id: 'acct-1', balance: 5000 }); },
      observe: () => { throw new Error('observer bug'); } });
    expect(await watched.readBalanceDisplay('acct-1')).toMatchObject({ cached: false, displayTotal: 5000 });
  });

  it('flags only outages', () => {
    expect(new NessieError('x', 503, true).outage).toBe(true);
    expect(new NessieError('invalid account balance').outage).toBe(false);
  });
});
