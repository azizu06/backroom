import { getRouterTelemetry } from '@backroom/orchestrator';
import { createGx10Reader } from '../../../lib/gx10/status';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const read = createGx10Reader({ telemetry: getRouterTelemetry });

/** Aggregate public evidence only. Does not start inference or change routing. */
export async function GET() {
  return Response.json(await read(), { headers: { 'Cache-Control': 'no-store' } });
}
