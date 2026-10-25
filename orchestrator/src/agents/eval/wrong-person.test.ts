import { expect, it, vi } from 'vitest';
import { probeWrongPersonReply } from './wrong-person';

it('C08 relay returns the code-owned wrong-person line with the business name and callback only', async () => {
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_NETWORK'));
  try {
    const run = await probeWrongPersonReply();
    expect(run.checks).toEqual(Object.fromEntries(Object.keys(run.checks).map(key => [key, true])));
    expect(run.speak).toContain('Northfield Studio');
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});
