import { describe, expect, it, vi } from 'vitest';
import { createApifyHealthCheck, createCrsCreditCheck, type CrsClientApi } from './adapters';

const evidence = (product: 'businessCredit' | 'ofac') => ({ source: 'crs_sandbox' as const, product,
  testIdentityId: 7, label: 'SANDBOX: test identity #7', checkedAt: '2026-10-24T01:00:00Z', responseHash: 'a'.repeat(64),
  summary: product === 'ofac' ? { ofacStatus: 'clear' as const } : { creditScore: 40 },
});

describe('pre-call integration adapters', () => {
  it('requests both CRS products with only the mapped test ID and applies an explicit owner credit mapping', async () => {
    const client = { getBusinessCreditReport: vi.fn<CrsClientApi['getBusinessCreditReport']>(async () => evidence('businessCredit')), checkOfac: vi.fn(async () => evidence('ofac')) };
    const check = createCrsCreditCheck(client, score => score !== undefined && score < 50 ? ['elevated_risk'] : []);
    expect(await check.check(7)).toMatchObject({ testIdentityId: 7, ofacStatus: 'clear', activeSignals: ['elevated_risk'], evidence: [expect.objectContaining({ creditScore: 40 }), expect.objectContaining({ product: 'ofac' })] });
    expect(client.getBusinessCreditReport).toHaveBeenCalledWith(7);
    expect(client.checkOfac).toHaveBeenCalledWith(7);
  });

  it('preserves a sanctions hit even if the concurrent credit product fails', async () => {
    const client = { getBusinessCreditReport: vi.fn<CrsClientApi['getBusinessCreditReport']>(async () => { throw new Error('credit down'); }),
      checkOfac: vi.fn(async () => ({ ...evidence('ofac'), summary: { ofacStatus: 'hit' as const } })) };
    expect(await createCrsCreditCheck(client).check(7)).toMatchObject({ ofacStatus: 'hit' });
  });

  it('does not treat an absent credit report as a completed check or mismatched OFAC evidence as clearance', async () => {
    const client = { getBusinessCreditReport: vi.fn<CrsClientApi['getBusinessCreditReport']>(async () => { throw new Error('credit down'); }), checkOfac: vi.fn(async () => evidence('ofac')) };
    expect(await createCrsCreditCheck(client).check(7)).toMatchObject({ ofacStatus: 'unknown' });
    client.getBusinessCreditReport.mockImplementation(async () => evidence('businessCredit'));
    client.checkOfac.mockImplementation(async () => ({ ...evidence('ofac'), testIdentityId: 8 }));
    expect(await createCrsCreditCheck(client).check(7)).toMatchObject({ ofacStatus: 'unknown' });
  });

  it('passes the real company to the Actor runner and projects only sourced typed signals', async () => {
    const company = { name: 'Public business', website: 'https://example.com' };
    const signal = new AbortController().signal;
    const runner = vi.fn(async () => ({ signals: [{ type: 'maps_status', value: 'operating', sourceUrl: 'https://maps.google.com/example', observedAt: '2026-10-24T01:00:00Z', rawHtml: '<html>untrusted</html>' }] }));
    const result = await createApifyHealthCheck(runner).check(company, signal);
    expect(runner).toHaveBeenCalledWith(company, signal);
    expect(result.signals[0]).not.toHaveProperty('rawHtml');
  });
});
