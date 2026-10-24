import { describe, expect, it, vi } from 'vitest';
import { createInboxVendorGate } from './checks';

describe('judge inbox vendor checks', () => {
  it('labels offline CRS, OFAC, and Apify as simulated and keeps the planted stops', async () => {
    const { checks, simulated } = createInboxVendorGate({});
    expect(simulated).toBe(true);
    expect(await checks.business('cedar')).toMatchObject({ verified: true, evidenceRef: 'simulated:crs:cedar' });
    expect(await checks.ofac('cedar')).toMatchObject({ status: 'clear', evidenceRef: 'simulated:ofac:cedar' });
    expect(await checks.footprint('cedar')).toMatchObject({ websiteReachable: true, listingOperating: true, domain: 'cedarfreight.example', evidenceRef: 'simulated:apify:cedar' });
    expect(await checks.ofac('sanctions-test')).toMatchObject({ status: 'hit', evidenceRef: 'simulated:ofac:sanctions-test' });
    expect(await checks.footprint('unverified')).toMatchObject({ websiteReachable: false, listingOperating: false, evidenceRef: 'simulated:apify:unverified' });
    expect(await checks.ofac('missing-vendor')).toMatchObject({ status: 'unknown', evidenceRef: 'simulated:ofac:unknown' });
    expect(await checks.business('missing-vendor')).toMatchObject({ verified: false });
  });

  it('does not promote an unknown live check into a clear result', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const { checks, simulated } = createInboxVendorGate({ DEMO_LIVE: '1' }, fetchImpl);
    expect(simulated).toBe(false);
    expect(await checks.business('cedar')).toMatchObject({ verified: false, evidenceRef: 'crs:business:unavailable' });
    expect(await checks.ofac('cedar')).toMatchObject({ status: 'unknown', evidenceRef: 'crs:ofac:unavailable' });
    expect(await checks.footprint('cedar')).toMatchObject({ websiteReachable: false, listingOperating: false, evidenceRef: 'apify:unavailable' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
