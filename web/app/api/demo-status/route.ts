import { getRouterHealth, getStateStore } from '@backroom/orchestrator';
import { readServiceStatus, type ProbeState, type ServiceProbe } from '../../../lib/demo-probes';
import { probedServices, type DemoStatus, type ServiceId } from '../../../lib/real-vs-sim';

export const dynamic = 'force-dynamic';

const states: readonly ProbeState[] = ['verified', 'simulated', 'unreachable', 'unverified', 'disabled'];
const sources: readonly ServiceProbe['source'][] = ['live', 'receipt', 'config'];

/** Allowlist each probe so a status source can never publish extra fields. */
function publicProbe(value: unknown): ServiceProbe | null {
  if (!value || typeof value !== 'object') return null;
  const { state, source, evidence, at } = value as Record<string, unknown>;
  if (!states.includes(state as ProbeState) || !sources.includes(source as ServiceProbe['source']) || typeof evidence !== 'string') return null;
  return { state: state as ProbeState, source: source as ServiceProbe['source'], evidence, at: typeof at === 'string' ? at : null };
}

/** Public disclosure only. No credentials, customer data, controls or model requests. */
export async function GET() {
  const health = getRouterHealth();
  const snapshot = await readServiceStatus();
  const services: Partial<Record<ServiceId, ServiceProbe>> = {};
  for (const id of probedServices) {
    const probe = publicProbe(snapshot?.services?.[id]);
    if (probe) services[id] = probe;
  }
  const status: DemoStatus = {
    measuredAt: new Date().toISOString(),
    llmEnabled: getStateStore().llmEnabled,
    notProbed: probedServices.filter(id => !services[id]),
    gx10: health ? {
      localEnabled: health.localEnabled,
      localAvailable: health.localAvailable,
      checkedAt: health.checkedAt,
    } : null,
    probesCheckedAt: snapshot && typeof snapshot.checkedAt === 'string' ? snapshot.checkedAt : null,
    services,
  };
  return Response.json(status, { headers: { 'Cache-Control': 'no-store' } });
}
