import { expect, it, vi } from 'vitest';
import { replayRecordedCrsCoverage } from './crs-availability';

it('replays the recorded public-records identity without turning its bankruptcy result into OFAC clearance or a sanctions hit', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_NETWORK'));
  try {
    const run = await replayRecordedCrsCoverage();
    expect(run.recordedProducts).toEqual(['fraudRisk', 'publicRecords']);
    expect(run.recordedTestIdentityId).toBe(6);
    expect(run.replay).toEqual({ ofacStatus: 'unknown', ofacAvailability: 'not available in sandbox', bankruptcy: true });
    expect(run.recordedOfacEvidence).toBe(false);
    expect(run.networkCalls).toBe(0);
    expect(run.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(run.scope).toContain('not a new CRS request');
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});
