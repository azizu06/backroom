/** A recorded pre-call signal row (orchestrator collections/signals.ts SignalRow), as the host holds it. */
export interface PrecallSignal { source: string; type: string; value: unknown; observedAt: string; label: string; sourceUrl?: string }
/** What the host already published: services.preCall plus the Apify rows it recorded for invoice 1042. */
export interface PrecallEvidence {
  preCall?: { status: string; reason?: string; warnings?: unknown };
  signals?: readonly PrecallSignal[];
}
const root = globalThis as typeof globalThis & { backroomDemoPrecall?: () => PrecallEvidence };
/** The demo host installs its prepare() evidence here. Kept out of lib/demo so the public route does not trace the host. */
export const getPrecallEvidence = () => root.backroomDemoPrecall?.() ?? null;
export function installPrecallEvidence(read: (() => PrecallEvidence) | undefined) { root.backroomDemoPrecall = read; }

export interface PrecallCard {
  business: 'open' | 'closed' | 'unknown';
  businessDetail: string;
  /** The signal row's label verbatim (Apify live run id, FAKE, cached). Never upgraded. */
  source: string;
  sourceHost?: string;
  checkedAt?: string;
  phoneMatch: 'yes' | 'no' | 'unknown';
  status: 'ready' | 'blocked' | 'paused' | 'not prepared';
  reason?: string;
  warnings: string[];
}

const MAPS: Record<string, [PrecallCard['business'], string]> = {
  operating: ['open', 'Operating'],
  permanently_closed: ['closed', 'Permanently closed'],
  temporarily_closed: ['closed', 'Temporarily closed'],
  unknown: ['unknown', 'Status unknown'],
};

function host(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try { return new URL(url).host || undefined; } catch { return undefined; }
}
function utcTime(at: string): string | undefined {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? `${new Date(ms).toISOString().slice(11, 16)} UTC` : undefined;
}

/** Maps host evidence to the desk-phone card. Missing evidence reads unknown, never open. */
export function precallCard(evidence: PrecallEvidence | null | undefined): PrecallCard {
  const rows = (evidence?.signals ?? []).filter(row => row.source === 'apify');
  const maps = rows.find(row => row.type === 'apify_maps_status');
  const phone = rows.find(row => row.type === 'apify_phone_match');
  // Maps and phone decide open/closed and the match. A website-only live run still has a row:
  // its label, host and time are the evidence. Missing maps or phone stay unknown.
  const shown = maps ?? phone ?? rows[0];
  const [business, businessDetail] = (maps && typeof maps.value === 'string' && Object.hasOwn(MAPS, maps.value) && MAPS[maps.value]) || MAPS.unknown!;
  const pre = evidence?.preCall;
  const status = pre?.status === 'ready' || pre?.status === 'blocked' || pre?.status === 'paused' ? pre.status : 'not prepared';
  const sourceHost = host(shown?.sourceUrl), checkedAt = shown && utcTime(shown.observedAt);
  return {
    business, businessDetail: maps ? businessDetail : 'Not checked',
    source: shown?.label ?? 'No Apify evidence recorded',
    ...(sourceHost ? { sourceHost } : {}), ...(checkedAt ? { checkedAt } : {}),
    phoneMatch: phone?.value === true ? 'yes' : phone?.value === false ? 'no' : 'unknown',
    status, ...(status !== 'ready' && status !== 'not prepared' && typeof pre?.reason === 'string' ? { reason: pre.reason } : {}),
    warnings: Array.isArray(pre?.warnings) ? pre.warnings.filter((item): item is string => typeof item === 'string') : [],
  };
}

/** Label/value rows shared by the desk phone's prop panel and the card. */
export function precallRows(card: PrecallCard): { label: string; value: string }[] {
  return [
    { label: 'Business', value: card.business === 'unknown' ? card.businessDetail : `${card.business === 'open' ? 'Open' : 'Closed'} · ${card.businessDetail}` },
    { label: 'Source', value: card.sourceHost ? `${card.source} · ${card.sourceHost}` : card.source },
    ...(card.checkedAt ? [{ label: 'Checked', value: card.checkedAt }] : []),
    { label: 'Phone match', value: card.phoneMatch },
    { label: 'Pre-call', value: card.reason ? `${card.status} · ${card.reason}` : card.status },
    ...card.warnings.map(warning => ({ label: 'Warning', value: warning })),
  ];
}

/** Whether the desk phone may offer Request call, and the one-line reason when it may not. The server gate still decides. */
export function precallGate(card: PrecallCard | null, mock: boolean): { ready: boolean; note?: string } {
  if (mock || card?.status === 'ready') return { ready: true };
  if (card?.status === 'blocked') return { ready: false, note: `Blocked: ${card.reason ?? 'pre-call check failed'}` };
  if (card?.status === 'paused') return { ready: false, note: `Paused: ${card.reason ?? 'pre-call check paused'}` };
  return { ready: false, note: 'Pre-call not ready' };
}
