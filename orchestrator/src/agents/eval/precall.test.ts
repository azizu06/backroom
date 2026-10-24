import { afterEach, expect, it, vi } from 'vitest';
import { PRECALL_STOPS, runPrecallStop } from './precall';

afterEach(() => vi.unstubAllGlobals());

it.each(PRECALL_STOPS)('%s: planner refuses with the key rule and a direct dial is rejected before any provider request', async id => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runPrecallStop(id);
  expect(run.checks).toEqual(Object.fromEntries(Object.keys(run.checks).map(key => [key, true])));
});
