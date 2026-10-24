import { afterEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({
  llmEnabled: false,
  health: null as null | { localEnabled: boolean; localAvailable: boolean; checkedAt: string | null; privateField?: string },
}));
vi.mock('@backroom/orchestrator', () => ({
  getStateStore: () => ({ llmEnabled: runtime.llmEnabled }),
  getRouterHealth: () => runtime.health,
}));
import { GET } from '../app/api/demo-status/route';
afterEach(() => vi.unstubAllGlobals());

it('reads OFF with no network requests and no secret or control exposure', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const response = GET();
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({ measuredAt: expect.any(String), llmEnabled: false, gx10: null });
  expect(fetch).not.toHaveBeenCalled();
});

it('publishes only the health allowlist', async () => {
  runtime.llmEnabled = true;
  runtime.health = { localEnabled: true, localAvailable: false, checkedAt: '2026-10-24T08:00:00.000Z', privateField: 'must-not-leak' };
  expect(await GET().json()).toEqual({ measuredAt: expect.any(String), llmEnabled: true, gx10: {
    localEnabled: true, localAvailable: false, checkedAt: '2026-10-24T08:00:00.000Z',
  } });
});
