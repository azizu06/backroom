import type { ServiceProbe } from './demo-probes';

export type ServiceId = 'phone' | 'claude' | 'gx10' | 'apify' | 'policy' | 'spacetime';
/** Sandbox services that carry a status only when the demo web host reports one. */
export type HostSandboxId = 'nessie' | 'crs';
export type StatusId = ServiceId | HostSandboxId;
export const hostSandboxServices = ['nessie', 'crs'] as const satisfies readonly HostSandboxId[];
export type DisclosureItem = {
  id: ServiceId | 'crs' | 'nessie' | 'company' | 'card';
  kind: 'real' | 'sandbox';
  label: string;
  description: string;
};

export const disclosureItems = [
  { id: 'phone', kind: 'real', label: 'Phone call', description: 'A real voice connection through Cartesia. Verified from the latest voice webhook receipt written by the call receiver.' },
  { id: 'claude', kind: 'real', label: 'Claude', description: 'Cloud model for language and judgment. Code controls commitments. Verified from a committed route receipt, or from validated pre-call inference in this demo host; no paid call is made per page load.' },
  { id: 'gx10', kind: 'real', label: 'GX10 local model', description: 'On-site model for routine tasks. Verified by a live, read-only probe of /v1/models.' },
  { id: 'apify', kind: 'real', label: 'Apify public data', description: 'Public web data, not private financial records. Verified from the last Apify run receipt, or from the one capped run in this demo host.' },
  { id: 'policy', kind: 'real', label: 'Policy engine', description: 'Deterministic server-side rules decide permissions and commitments. Verified from a policy decision receipt; enforcement is independent of this view.' },
  { id: 'spacetime', kind: 'real', label: 'SpacetimeDB', description: 'Shared state and audit subscriptions. Verified by a live SpacetimeDB database probe, or shown as a fixture when the in-memory store is used.' },
  { id: 'crs', kind: 'sandbox', label: 'CRS test identities', description: 'Sandbox identities only; no real customer credit reports.' },
  { id: 'nessie', kind: 'sandbox', label: 'Nessie bank', description: 'Sandbox bank accounts and transactions; no real money moves.' },
  { id: 'company', kind: 'sandbox', label: 'Company, vendors & emails', description: 'Northfield Studio and its business records are fictional demo fixtures.' },
  { id: 'card', kind: 'sandbox', label: 'Pay page card', description: 'Simulated card payment; the demo creates a sandbox Nessie deposit.' },
] as const satisfies readonly DisclosureItem[];

/** Services /api/demo-status reports evidence for. Any id it lists in `notProbed` is shown as NOT_PROBED_LABEL. */
export const probedServices = ['phone', 'claude', 'gx10', 'apify', 'policy', 'spacetime'] as const satisfies readonly ServiceId[];
export const unprobedServices = disclosureItems
  .filter(item => item.kind === 'real' && !(probedServices as readonly string[]).includes(item.id))
  .map(item => item.id as ServiceId);
export const NOT_PROBED_LABEL = 'Not probed in this process';
export const CHECKING_LABEL = 'Checking…';

export type DemoStatus = {
  measuredAt: string;
  /** Always sent by /api/demo-status; optional so older payloads still parse. */
  notProbed?: ServiceId[];
  llmEnabled: boolean;
  gx10: {
    localEnabled: boolean;
    localAvailable: boolean;
    checkedAt: string | null;
  } | null;
  probesCheckedAt?: string | null;
  services?: Partial<Record<StatusId, ServiceProbe>>;
};
export type DisclosureStatus = { label: string; tone: 'neutral' | 'good' | 'warning'; detail?: string };

/** Live observations older than this are no longer claimed as Verified. */
export const LIVE_PROBE_MAX_AGE_MS = 120_000;
const STATUS_MAX_AGE_MS = 30_000;
// Fixed UTC formatting so server and client renders agree.
const receiptTime = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const liveTime = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function probeStatus(probe: ServiceProbe, now: number): DisclosureStatus {
  const unverified: DisclosureStatus = { label: 'Unverified', tone: 'neutral' };
  switch (probe.state) {
    case 'verified': {
      const at = Date.parse(probe.at ?? '');
      if (!Number.isFinite(at)) return unverified;
      if (probe.source === 'live' && Math.abs(now - at) > LIVE_PROBE_MAX_AGE_MS) return unverified;
      const time = `${(probe.source === 'live' ? liveTime : receiptTime).format(at)} UTC`;
      return { label: 'Verified', tone: 'good', detail: `${probe.evidence} · ${time}` };
    }
    case 'simulated': return { label: 'Simulated', tone: 'neutral', detail: probe.evidence };
    case 'unreachable': return { label: 'Unreachable', tone: 'warning', detail: probe.evidence };
    case 'disabled': return { label: 'Disabled', tone: 'warning', detail: probe.evidence };
    case 'unverified': return { label: 'Unverified', tone: 'neutral', detail: probe.evidence };
    default: return unverified;
  }
}

// Do not retain an ON/online claim after a disconnected or stalled status poll.
function isCurrent(status: DemoStatus | null, now: number): status is DemoStatus {
  return !!status && Number.isFinite(Date.parse(status.measuredAt)) && now - Date.parse(status.measuredAt) <= STATUS_MAX_AGE_MS;
}

export function getDisclosureStatus(item: DisclosureItem, status: DemoStatus | null, now = Date.now()): DisclosureStatus {
  const unverified: DisclosureStatus = { label: 'Unverified', tone: 'neutral' };
  const current = isCurrent(status, now);
  if (item.kind === 'sandbox') {
    // Sandbox rows stay Simulated unless the demo host reports their adapter; a sandbox is never 'real'.
    const probe = current && (hostSandboxServices as readonly string[]).includes(item.id) ? status!.services?.[item.id as HostSandboxId] : undefined;
    return probe ? probeStatus(probe, now) : { label: 'Simulated', tone: 'neutral' };
  }
  if (!current || !status) return unverified;
  if (['phone', 'claude', 'gx10'].includes(item.id) && !status.llmEnabled) return { label: 'LLM OFF', tone: 'warning' };
  const id = item.id as ServiceId;
  if (status.notProbed?.includes(id)) return { label: NOT_PROBED_LABEL, tone: 'neutral' };
  const probe = status.services?.[id];
  if (probe) return probeStatus(probe, now);
  if (id === 'gx10' && status.gx10) {
    if (!status.gx10.localEnabled) return { label: 'Disabled', tone: 'warning' };
    const checkedAt = Date.parse(status.gx10.checkedAt ?? '');
    if (Number.isFinite(checkedAt) && now - checkedAt <= STATUS_MAX_AGE_MS) {
      return status.gx10.localAvailable ? { label: 'Online', tone: 'good' } : { label: 'Offline', tone: 'warning' };
    }
  }
  // services present but probesCheckedAt null: the server's first probe run has not finished yet.
  if (status.services && status.probesCheckedAt === null) return { label: CHECKING_LABEL, tone: 'neutral' };
  return unverified;
}

/** The one-line disclosure every page shows. Money wording follows the host's Nessie adapter, so every page agrees. */
export function demoPillText(status: DemoStatus | null, now = Date.now()) {
  const current = isCurrent(status, now);
  const nessie = current ? status.services?.nessie : undefined;
  const money = !nessie ? 'sandbox money' : nessie.state === 'simulated' ? 'mock bank money' : 'Nessie sandbox money';
  return ['Demo', 'synthetic company', money, ...(current && !status.llmEnabled ? ['LLM OFF'] : [])].join(' · ');
}
