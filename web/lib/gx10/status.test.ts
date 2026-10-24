import { expect, it, vi } from 'vitest';
import { createGx10Reader } from './status';

it('probes only loaded models, coalesces readers and caches for two seconds', async () => {
  let now = 0;
  const http = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ models: [{ name: 'gpt-oss:20b', digest: 'private-unneeded' }] }));
  const read = createGx10Reader({ fetch: http, now: () => now, telemetry: () => null });
  const [a, b] = await Promise.all([read(), read()]);
  expect(a).toEqual(b);
  expect(a).toMatchObject({ reachable: true, models: ['gpt-oss:20b'], telemetry: null, gpuUtilization: null });
  expect(http).toHaveBeenCalledTimes(1);
  expect(http.mock.calls[0]?.[0]).toBe('http://100.117.44.20:11434/api/ps');
  expect(http.mock.calls[0]?.[1]).toMatchObject({ signal: expect.any(AbortSignal), cache: 'no-store' });
  expect(JSON.stringify(a)).not.toContain('private-unneeded');
  await read();
  expect(http).toHaveBeenCalledTimes(1);
  now = 2001;
  http.mockResolvedValueOnce(Response.json({ models: [] }));
  expect((await read()).models).toEqual([]);
  expect(http).toHaveBeenCalledTimes(2);
});

it.each([
  ['HTTP error', () => new Response('private error body', { status: 503 })],
  ['invalid shape', () => Response.json({ models: [{ digest: 'untrusted' }] })],
  ['oversize body', () => new Response('x'.repeat(65537))],
  ['transport failure', () => { throw new Error('sensitive host diagnostic'); }],
] as const)('returns a redacted offline state on %s', async (_name, response) => {
  const read = createGx10Reader({ fetch: vi.fn<typeof fetch>().mockImplementation(async () => response()), telemetry: () => null });
  const status = await read();
  expect(status).toMatchObject({ reachable: false, models: [], telemetry: null });
  expect(JSON.stringify(status)).not.toMatch(/sensitive|private|untrusted/);
});

it('bounds an unresponsive HTTP probe to 1.5 seconds', async () => {
  vi.useFakeTimers();
  try {
    const http = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    }));
    const result = createGx10Reader({ fetch: http, telemetry: () => null })();
    await vi.advanceTimersByTimeAsync(1501);
    expect((await result).reachable).toBe(false);
  } finally { vi.useRealTimers(); }
});
