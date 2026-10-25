import { describe, expect, it } from 'vitest';
import { createNessieEvidence } from './nessie-evidence';

const T0 = Date.parse('2026-10-24T15:00:00.000Z');

describe('Nessie host evidence', () => {
  it('has no proof until the sandbox answers', () => {
    expect(createNessieEvidence(() => T0).snapshot()).toEqual({});
  });
  it('records only successful GET reads as read proof', () => {
    let now = T0;
    const evidence = createNessieEvidence(() => now);
    evidence.observe({ method: 'POST', status: 201 });
    expect(evidence.snapshot()).toEqual({});
    now += 1000;
    evidence.observe({ method: 'GET', status: 200 });
    expect(evidence.snapshot()).toEqual({ proof: { kind: 'sandbox_read', at: new Date(T0 + 1000).toISOString() } });
  });
  it('prefers a reconciled deposit over a later read', () => {
    let now = T0;
    const evidence = createNessieEvidence(() => now);
    evidence.depositMatched('dep-1');
    now += 1000;
    evidence.observe({ method: 'GET', status: 200 });
    expect(evidence.snapshot().proof).toEqual({ kind: 'deposit_exact_match', at: new Date(T0).toISOString(), depositId: 'dep-1' });
  });
  it('marks a thrown or non-OK read unreachable without changing the result, and a later read clears it', async () => {
    const evidence = createNessieEvidence(() => T0);
    const down = evidence.watch(async () => { throw new Error('offline'); });
    await expect(down('https://example.test/accounts/a')).rejects.toThrow('offline');
    expect(evidence.snapshot()).toEqual({ unreachableAt: new Date(T0).toISOString() });
    evidence.observe({ method: 'GET', status: 200 });
    expect(evidence.snapshot().unreachableAt).toBeUndefined();
    const refused = evidence.watch(async () => new Response('no', { status: 503 }));
    expect((await refused('https://example.test/accounts/a')).status).toBe(503);
    expect(evidence.snapshot().unreachableAt).toBe(new Date(T0).toISOString());
  });
  it('does not treat a failed write as a failed read', async () => {
    const evidence = createNessieEvidence(() => T0);
    const http = evidence.watch(async () => new Response('bad', { status: 400 }));
    await http('https://example.test/accounts/a/deposits', { method: 'POST' });
    expect(evidence.snapshot()).toEqual({});
  });
});
