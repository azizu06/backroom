export type ServiceId = 'phone' | 'claude' | 'gx10' | 'apify' | 'policy' | 'spacetime';
export type DisclosureItem = {
  id: ServiceId | 'crs' | 'nessie' | 'company' | 'card';
  kind: 'real' | 'sandbox';
  label: string;
  description: string;
};

export const disclosureItems = [
  { id: 'phone', kind: 'real', label: 'Phone call', description: 'A real voice connection through Cartesia. Connection status is not yet reported here.' },
  { id: 'claude', kind: 'real', label: 'Claude', description: 'Cloud model for language and judgment. Code controls commitments; provider availability is not yet reported here.' },
  { id: 'gx10', kind: 'real', label: 'GX10 local model', description: 'On-site model for routine tasks. Status comes from the model router in this server process.' },
  { id: 'apify', kind: 'real', label: 'Apify public data', description: 'Public web data, not private financial records. Run status is not yet reported here.' },
  { id: 'policy', kind: 'real', label: 'Policy engine', description: 'Deterministic server-side rules decide permissions and commitments. Enforcement is independent of this view.' },
  { id: 'spacetime', kind: 'real', label: 'SpacetimeDB', description: 'Shared state and audit subscriptions. Connection status is not yet reported here.' },
  { id: 'crs', kind: 'sandbox', label: 'CRS test identities', description: 'Sandbox identities only; no real customer credit reports.' },
  { id: 'nessie', kind: 'sandbox', label: 'Nessie bank', description: 'Sandbox bank accounts and transactions; no real money moves.' },
  { id: 'company', kind: 'sandbox', label: 'Company, vendors & emails', description: 'Northfield Studio and its business records are fictional demo fixtures.' },
  { id: 'card', kind: 'sandbox', label: 'Pay page card', description: 'Simulated card payment; the demo creates a sandbox Nessie deposit.' },
] as const satisfies readonly DisclosureItem[];

/** Services /api/demo-status observes in this server process. Everything else is never probed here. */
export const probedServices = ['gx10'] as const satisfies readonly ServiceId[];
export const unprobedServices = disclosureItems
  .filter(item => item.kind === 'real' && !(probedServices as readonly string[]).includes(item.id))
  .map(item => item.id as ServiceId);
export const NOT_PROBED_LABEL = 'Not probed in this process';

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
};
export type DisclosureStatus = { label: string; tone: 'neutral' | 'good' | 'warning' };

export function getDisclosureStatus(item: DisclosureItem, status: DemoStatus | null, now = Date.now()): DisclosureStatus {
  if (item.kind === 'sandbox') return { label: 'Simulated', tone: 'neutral' };
  const probed = (probedServices as readonly string[]).includes(item.id);
  const notProbed: DisclosureStatus = { label: NOT_PROBED_LABEL, tone: 'neutral' };
  // Do not retain an ON/online claim after a disconnected or stalled status poll.
  if (!status || !Number.isFinite(Date.parse(status.measuredAt)) || now - Date.parse(status.measuredAt) > 30_000) {
    return probed ? { label: 'Unverified', tone: 'neutral' } : notProbed;
  }
  if (['phone', 'claude', 'gx10'].includes(item.id) && !status.llmEnabled) return { label: 'LLM OFF', tone: 'warning' };
  if (!probed) return notProbed;
  if (item.id === 'gx10' && status.gx10) {
    if (!status.gx10.localEnabled) return { label: 'Disabled', tone: 'warning' };
    const checkedAt = Date.parse(status.gx10.checkedAt ?? '');
    if (Number.isFinite(checkedAt) && now - checkedAt <= 30_000) {
      return status.gx10.localAvailable ? { label: 'Online', tone: 'good' } : { label: 'Offline', tone: 'warning' };
    }
  }
  return { label: 'Unverified', tone: 'neutral' };
}
