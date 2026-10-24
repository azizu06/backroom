import { expect, it } from 'vitest';
import { serverRoomReadout } from './server-room';
import type { Gx10Status } from './status';

it('does not present stale evidence as a live GX10 or fresh throughput', () => {
  const now = Date.now();
  const status: Gx10Status = { measuredAt: new Date(now).toISOString(), reachable: true, models: ['gpt-oss:20b'], gpuUtilization: null,
    telemetry: { scope: 'process-local, last 200 HTTP attempts', totalCalls: 2, localCalls: 1, localShare: 0.5,
      estimatedSavingsUsd: 0.003, pricedLocalCalls: 1, comparisonModel: 'claude-sonnet-5-5',
      recent: { at: new Date(now - 61_000).toISOString(), latencyMs: 1000, tokensPerSecond: 100 } } };
  expect(serverRoomReadout(status, now)).toMatchObject({ connection: 'Online', share: '50%', speed: '—', latency: '—', savings: '~$0.003000' });
  expect(serverRoomReadout(status, now + 11_000)).toMatchObject({ connected: false, connection: 'Telemetry unavailable', share: '—', savings: '—' });
  expect(serverRoomReadout(null)).toMatchObject({ share: '—', savings: '—', calls: 'No router receipts in this process' });
});
