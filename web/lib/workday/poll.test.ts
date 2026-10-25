import { afterEach, expect, it, vi } from 'vitest';
import { pollWorkday } from './poll';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('never requests protected workday state for anonymous viewers, then detects sign-in', async () => {
  vi.useFakeTimers();
  let signedIn = false;
  const http = vi.fn(async (url: string) => url === '/api/session'
    ? Response.json({ signedIn }) : Response.json({ status: 'ready' }));
  vi.stubGlobal('fetch', http);
  const onResponse = vi.fn();
  const stop = pollWorkday(1000, onResponse, vi.fn());
  await vi.advanceTimersByTimeAsync(5000);
  expect(http.mock.calls.every(([url]) => url === '/api/session')).toBe(true);
  expect(onResponse).toHaveBeenCalledWith(null);
  signedIn = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(http.mock.calls.at(-1)?.[0]).toBe('/api/operator/workday');
  expect(onResponse.mock.calls.at(-1)?.[0]?.ok).toBe(true);
  stop();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([401, 403])('stops polling after workday rejects the session with %s', async status => {
  vi.useFakeTimers();
  const http = vi.fn(async (url: string) => url === '/api/session'
    ? Response.json({ signedIn: true }) : new Response(null, { status }));
  vi.stubGlobal('fetch', http);
  const onResponse = vi.fn(), onError = vi.fn();
  const stop = pollWorkday(1000, onResponse, onError);
  await vi.advanceTimersByTimeAsync(10000);
  expect(http).toHaveBeenCalledTimes(2);
  expect(onResponse.mock.calls[0]?.[0]?.status).toBe(status);
  expect(onError).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  stop();
});

it('does not send the protected request if unmounted during the session check', async () => {
  vi.useFakeTimers();
  let resolve!: (response: Response) => void;
  const http = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
  vi.stubGlobal('fetch', http);
  const onResponse = vi.fn();
  const stop = pollWorkday(1000, onResponse, vi.fn());
  stop();
  resolve(Response.json({ signedIn: true }));
  await vi.advanceTimersByTimeAsync(10000);
  expect(http).toHaveBeenCalledTimes(1);
  expect(onResponse).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('recovers from a workday network error without overlapping requests', async () => {
  vi.useFakeTimers();
  const http = vi.fn().mockResolvedValueOnce(Response.json({ signedIn: true }))
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(Response.json({ signedIn: true }))
    .mockResolvedValueOnce(Response.json({ status: 'running' }));
  vi.stubGlobal('fetch', http);
  const onResponse = vi.fn(), onError = vi.fn();
  const stop = pollWorkday(1000, onResponse, onError);
  await vi.advanceTimersByTimeAsync(0);
  expect(onError).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(onResponse).toHaveBeenCalledTimes(1);
  stop();
});
