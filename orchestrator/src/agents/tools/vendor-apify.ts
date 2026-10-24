/**
 * Apify public-web evidence for the Vendor verifier. Two Actors, both budgeted:
 *  - the team's client-health-check Actor (website reachable) via the existing collections runner;
 *  - the Store's Contact Details Scraper (vdrmota/contact-info-scraper) on the vendor's own site.
 * Only booleans, domains and digits leave this module. Scraped text never reaches a model, an
 * audit row or a policy input. Timeout/failure is "pending"/"unavailable" and never evidence.
 */
import { domain as normalizeDomain, validDomain as isDomain } from '../../payables/decisions';

export const CONTACT_ACTOR_ID = '9Sk4JJhEma9vBKqrg'; // vdrmota/contact-info-scraper
/** Apify refuses maxTotalChargeUsd below $0.50 for this Actor. Real spend is bounded far lower by
 * maxRequests=3 and the 35 s timeout (about $0.01); the budget settles to the reported usage. */
export const CONTACT_CAP_USD = 0.5;
const idLike = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9]{1,100}$/.test(value);

export interface ApifyBudgetOptions {
  /** Default ceiling passed to Apify as maxTotalChargeUsd when an Actor does not need more. */
  perRunCapUsd?: number;
  /** Runs one case (activation family) may start. */
  perCaseRuns?: number;
  /** Worst-case spend for the whole demo process. */
  demoCapUsd?: number;
}
export type Reservation = { ok: true; capUsd: number; settle(actualUsd?: number): void } | { ok: false; reason: 'CASE_RUNS' | 'DEMO_BUDGET' };

/** Reserve the full cap before a run starts; settle to the reported usage afterwards. A lost
 * response keeps the full cap reserved because the bill is unknown. */
export class ApifyBudget {
  readonly perRunCapUsd: number;
  private readonly perCaseRuns: number;
  private readonly demoCapUsd: number;
  private spent = 0;
  private readonly runs = new Map<string, number>();
  constructor(options: ApifyBudgetOptions = {}) {
    this.perRunCapUsd = options.perRunCapUsd ?? 0.10;
    this.perCaseRuns = options.perCaseRuns ?? 2;
    this.demoCapUsd = options.demoCapUsd ?? 5;
  }
  get spentUsd(): number { return Math.round(this.spent * 1e6) / 1e6; }
  reserve(caseId: string, capUsd = this.perRunCapUsd): Reservation {
    const cap = capUsd;
    if ((this.runs.get(caseId) ?? 0) >= this.perCaseRuns) return { ok: false, reason: 'CASE_RUNS' };
    if (this.spent + cap > this.demoCapUsd) return { ok: false, reason: 'DEMO_BUDGET' };
    this.runs.set(caseId, (this.runs.get(caseId) ?? 0) + 1);
    this.spent += cap;
    let settled = false;
    return { ok: true, capUsd: cap, settle: actual => {
      if (settled || actual === undefined || !Number.isFinite(actual) || actual < 0) return;
      settled = true;
      this.spent += Math.min(actual, cap) - cap;
    } };
  }
}

export interface ContactScrape {
  runId: string;
  usageUsd?: number;
  items: readonly unknown[];
}
/** Transport seam: one start request, no retries, so a lost response cannot bill twice. */
export type ContactRunner = (input: { startUrl: string; capUsd: number; signal: AbortSignal }) => Promise<ContactScrape>;

export function createContactRunner(options: { token?: string; fetch?: typeof fetch } = {}): ContactRunner {
  const http = options.fetch ?? fetch;
  return async ({ startUrl, capUsd, signal: callerSignal }) => {
    const token = options.token ?? process.env.APIFY_TOKEN;
    if (!token) throw new Error('Apify token unavailable');
    const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(40_000)]);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const params = new URLSearchParams({ waitForFinish: '35', timeout: '35', memory: '512',
      maxTotalChargeUsd: String(Math.max(capUsd, CONTACT_CAP_USD)), restartOnError: 'false' });
    const response = await http(`https://api.apify.com/v2/acts/${CONTACT_ACTOR_ID}/runs?${params}`, {
      method: 'POST', headers, signal,
      body: JSON.stringify({ startUrls: [{ url: startUrl }], maxRequests: 3, maxRequestsPerStartUrl: 3, maxDepth: 1,
        sameDomain: true, mergeContacts: true, useBrowser: false, maximumLeadsEnrichmentRecords: 0,
        proxyConfig: { useApifyProxy: true } }),
    });
    if (!response.ok) throw new Error('Apify contact run unavailable');
    const { data } = await response.json() as { data?: { id?: unknown; status?: unknown; defaultDatasetId?: unknown; usageTotalUsd?: unknown } };
    if (!data || !idLike(data.id) || data.status !== 'SUCCEEDED' || !idLike(data.defaultDatasetId)) throw new Error('Apify contact run pending');
    const itemsResponse = await http(`https://api.apify.com/v2/datasets/${data.defaultDatasetId}/items?format=json&clean=true&limit=5`, { headers, signal });
    if (!itemsResponse.ok) throw new Error('Apify contact dataset unavailable');
    const items: unknown = await itemsResponse.json();
    if (!Array.isArray(items)) throw new Error('Invalid Apify contact dataset');
    return { runId: data.id, items, ...(typeof data.usageTotalUsd === 'number' ? { usageUsd: data.usageTotalUsd } : {}) };
  };
}

export interface ContactFootprint {
  /** Distinct email domains the vendor's own pages publish (lower-case, max 20). */
  emailDomains: string[];
  /** Last ten digits of phone numbers published on the pages (max 10). */
  phoneTails: string[];
  pagesSeen: number;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown, max: number): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length <= 320).slice(0, max) : [];

/** Reduce raw scraper rows to the small facts we compare. Anything unexpected is dropped, not guessed. */
export function projectContactItems(items: readonly unknown[]): ContactFootprint {
  const emailDomains = new Set<string>(), phoneTails = new Set<string>();
  let pagesSeen = 0;
  for (const item of items.slice(0, 5)) {
    if (!record(item)) continue;
    pagesSeen += 1;
    for (const email of strings(item.emails, 50)) {
      const at = email.lastIndexOf('@');
      const host = at > 0 ? normalizeDomain(email.slice(at + 1)) : '';
      if (isDomain(host)) emailDomains.add(host);
    }
    for (const phone of [...strings(item.phones, 50), ...strings(item.phonesUncertain, 50)]) {
      const digits = phone.replace(/\D/g, '');
      if (digits.length >= 10 && digits.length <= 15) phoneTails.add(digits.slice(-10));
    }
  }
  return { emailDomains: [...emailDomains].slice(0, 20), phoneTails: [...phoneTails].slice(0, 10), pagesSeen };
}

/** True when `candidate` or one of its parent domains is published as an email domain on the vendor site. */
export function siteCorroboratesDomain(footprint: ContactFootprint, candidate: string): boolean {
  const target = normalizeDomain(candidate);
  return footprint.emailDomains.some(host => host === target || target.endsWith(`.${host}`) || host.endsWith(`.${target}`));
}
