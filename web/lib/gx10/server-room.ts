import type { Gx10Status } from './status';
export type { Gx10Status } from './status';

/** No old receipt is presented as a live connection or live throughput. */
export function serverRoomReadout(status: Gx10Status | null, now = Date.now()) {
  const fresh = status !== null && now - Date.parse(status.measuredAt) < 10_000;
  const telemetry = fresh ? status.telemetry : null;
  const recent = telemetry?.recent && now - Date.parse(telemetry.recent.at) < 60_000 ? telemetry.recent : null;
  return {
    connected: fresh && status.reachable,
    connection: !status ? 'Telemetry unavailable' : !fresh ? 'Telemetry unavailable' : status.reachable ? 'Online' : 'Unreachable',
    models: fresh && status.reachable ? status.models.join(', ') || 'No models loaded' : 'Loaded models unavailable',
    share: telemetry?.localShare == null ? '—' : `${Math.round(telemetry.localShare * 100)}%`,
    calls: telemetry ? `${telemetry.localCalls}/${telemetry.totalCalls} attempts local` : 'No router receipts in this process',
    speed: recent?.tokensPerSecond == null ? '—' : `${recent.tokensPerSecond.toFixed(1)} tok/s`,
    latency: recent ? `${(recent.latencyMs / 1000).toFixed(2)} s` : '—',
    savings: telemetry?.estimatedSavingsUsd == null ? '—' : `~$${telemetry.estimatedSavingsUsd.toFixed(6)}`,
    estimate: telemetry ? `${telemetry.pricedLocalCalls}/${telemetry.localCalls} local attempts metered vs ${telemetry.comparisonModel}` : 'Savings require measured token counts',
  };
}
