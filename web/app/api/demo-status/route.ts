import { getRouterHealth, getStateStore } from '@backroom/orchestrator';
import type { DemoStatus } from '../../../lib/real-vs-sim';

export const dynamic = 'force-dynamic';

/** Public disclosure only. No credentials, customer data, controls or model requests. */
export function GET() {
  const health = getRouterHealth();
  const status: DemoStatus = {
    measuredAt: new Date().toISOString(),
    llmEnabled: getStateStore().llmEnabled,
    gx10: health ? {
      localEnabled: health.localEnabled,
      localAvailable: health.localAvailable,
      checkedAt: health.checkedAt,
    } : null,
  };
  return Response.json(status, { headers: { 'Cache-Control': 'no-store' } });
}
