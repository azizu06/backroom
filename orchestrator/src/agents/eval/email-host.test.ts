import { expect, it, vi } from 'vitest';
import { runEmailHost } from './email-host';

it('C14 call refusal on the demo host route queues one simulated email per day and never dials', async () => {
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_NETWORK'));
  try {
    const run = await runEmailHost();
    expect(run.checks).toEqual(Object.fromEntries(Object.keys(run.checks).map(key => [key, true])));
    expect(run.match).toBe(true);
    expect(run.clicks.first).toMatchObject({ status: 409, error: 'CALL_DENIED', email: 'queued' });
    expect(run.clicks.repeat).toMatchObject({ email: 'duplicate' });
    expect(run.counts).toEqual({ network: 0, model: 0, providerStarts: 0 });
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});
