/** Typed public-company signals. No scraped prose, and no model sees this text. */

export interface MapsObservation {
  permanentlyClosed?: boolean;
  temporarilyClosed?: boolean;
  sourceUrl?: string;
  observedAt?: string;
}

export interface HealthInput {
  companyName?: string;
  website?: string;
  phone?: string;
  listedPhone?: string;
  websiteStatus?: number;
  maps?: MapsObservation;
  distress?: { value: boolean; sourceUrl: string; observedAt: string };
  observedAt: string;
}

export interface HealthSignal {
  type: 'maps_status' | 'website_reachable' | 'phone_match' | 'distress_news';
  value: string | boolean;
  sourceUrl: string;
  observedAt: string;
}

const digits = (value: string) => value.replace(/\D/g, '');

function httpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2000) return;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch { return; }
}

export function healthResult(input: HealthInput): { signals: HealthSignal[] } {
  const signals: HealthSignal[] = [];
  const observedAt = input.observedAt;
  const mapsUrl = httpUrl(input.maps?.sourceUrl);
  if (mapsUrl && input.maps?.observedAt && Number.isFinite(Date.parse(input.maps.observedAt))) {
    const value = input.maps.permanentlyClosed === true ? 'permanently_closed'
      : input.maps.temporarilyClosed === true ? 'temporarily_closed'
        : input.maps.permanentlyClosed === false && input.maps.temporarilyClosed === false ? 'operating'
          : 'unknown';
    signals.push({ type: 'maps_status', value, sourceUrl: mapsUrl, observedAt: input.maps.observedAt });
  }
  const website = httpUrl(input.website);
  if (website && typeof input.websiteStatus === 'number' && Number.isFinite(input.websiteStatus)) {
    signals.push({ type: 'website_reachable', value: input.websiteStatus >= 200 && input.websiteStatus < 400, sourceUrl: website, observedAt });
  }
  if (input.phone && input.listedPhone && (mapsUrl || website)) {
    const left = digits(input.phone);
    const right = digits(input.listedPhone);
    if (left && right) signals.push({ type: 'phone_match', value: left === right, sourceUrl: mapsUrl ?? website!, observedAt });
  }
  const distressUrl = httpUrl(input.distress?.sourceUrl);
  if (distressUrl && typeof input.distress?.value === 'boolean' && Number.isFinite(Date.parse(input.distress.observedAt))) {
    signals.push({ type: 'distress_news', value: input.distress.value, sourceUrl: distressUrl, observedAt: input.distress.observedAt });
  }
  return { signals };
}

export async function probeWebsite(url: string, fetchImpl: typeof fetch, signal?: AbortSignal): Promise<number | undefined> {
  if (!httpUrl(url)) return;
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'follow', signal });
    return response.status;
  } catch { return; }
}
