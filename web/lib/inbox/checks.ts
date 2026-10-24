import { createBankChangeRiskCheck, createCrsBankChangeRisk, createPreCallHealthCheck, northfield, northfieldVendor,
  type BankChangeRisk, type VendorChecks } from '@backroom/orchestrator';
import { createCachedCrsClientFromEnv, createCrsClientFromEnv } from '../../../orchestrator/src/integrations/crs/sandbox';
import type { CrsEvidence } from '../../../orchestrator/src/integrations/crs';

const hash = /^[a-f0-9]{64}$/;
/** Server-owned master mapping. Never an identity taken from the judge form. */
function identityFor(vendorId: string): number | undefined {
  const mapping = northfield.vendors.find(row => row.id === vendorId)?.crsIdentityMapping;
  return mapping?.status === 'mapped' && typeof mapping.sandboxIdentityId === 'number' ? mapping.sandboxIdentityId : undefined;
}
function accepted(evidence: CrsEvidence, product: CrsEvidence['product'], id: number) {
  return evidence.source === 'crs_sandbox' && !evidence.label.startsWith('FAKE') && evidence.product === product &&
    evidence.testIdentityId === id && hash.test(evidence.responseHash) && Number.isFinite(Date.parse(evidence.checkedAt));
}
function evidenceRef(product: 'business' | 'ofac', evidence: CrsEvidence) {
  return `crs:${product}:${evidence.cached ? 'cached:' : ''}${evidence.responseHash}`;
}

/** DEMO_LIVE selects the host clients. Offline uses the frozen Northfield fixtures and says so. */
export function createInboxVendorGate(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch): {
  checks: VendorChecks; risk: BankChangeRisk; simulated: boolean;
} {
  const live = env.DEMO_LIVE === '1';
  if (!live) {
    return { simulated: true, risk: createBankChangeRiskCheck({ env: {}, fetch: fetchImpl }), checks: {
      business: async id => ({ verified: northfield.vendors.some(row => row.id === id), evidenceRef: `simulated:crs:${id}` }),
      ofac: async id => {
        try {
          return { status: northfieldVendor(id).ofacHit === true ? 'hit' as const : 'clear' as const, evidenceRef: `simulated:ofac:${id}` };
        } catch { return { status: 'unknown' as const, evidenceRef: 'simulated:ofac:unknown' }; }
      },
      footprint: async id => {
        const row = northfield.vendors.find(vendor => vendor.id === id);
        if (!row) return { websiteReachable: false, listingOperating: false, domain: 'unknown.invalid', evidenceRef: 'simulated:apify:unknown' };
        return { websiteReachable: row.footprint.websiteReachable === true, listingOperating: row.footprint.listingOperating === true,
          domain: row.knownDomain, evidenceRef: `simulated:apify:${id}` };
      },
    } };
  }
  const crs = createCachedCrsClientFromEnv(env, fetchImpl) ?? createCrsClientFromEnv(env, fetchImpl);
  const health = createPreCallHealthCheck({ ...env, PRECALL_APIFY: 'live', APIFY_TOKEN: env.APIFY_TOKEN ?? '' } as unknown as NodeJS.ProcessEnv, fetchImpl);
  const footprints = new Map<string, ReturnType<VendorChecks['footprint']>>();
  return { simulated: false, risk: crs ? createCrsBankChangeRisk(crs, identityFor) : { async check() { throw new Error('CRS credentials unavailable'); } }, checks: {
    async business(vendorId) {
      const id = identityFor(vendorId);
      if (!crs || !id) return { verified: false, evidenceRef: 'crs:business:unavailable' };
      try {
        const evidence = await crs.getBusinessCreditReport(id);
        if (!accepted(evidence, 'businessCredit', id)) return { verified: false, evidenceRef: 'crs:business:unavailable' };
        const score = evidence.summary.creditScore;
        return { verified: typeof score === 'number' && Number.isFinite(score), evidenceRef: evidenceRef('business', evidence) };
      } catch { return { verified: false, evidenceRef: 'crs:business:unavailable' }; }
    },
    async ofac(vendorId) {
      const id = identityFor(vendorId);
      if (!crs || !id) return { status: 'unknown', evidenceRef: 'crs:ofac:unavailable' };
      try {
        const evidence = await crs.checkOfac(id);
        if (!accepted(evidence, 'ofac', id)) return { status: 'unknown', evidenceRef: 'crs:ofac:unavailable' };
        const status = evidence.summary.ofacStatus;
        return { status: status === 'hit' || status === 'clear' ? status : 'unknown', evidenceRef: evidenceRef('ofac', evidence) };
      } catch { return { status: 'unknown', evidenceRef: 'crs:ofac:unavailable' }; }
    },
    footprint(vendorId) {
      const row = northfield.vendors.find(vendor => vendor.id === vendorId);
      const domain = row?.knownDomain ?? 'unknown.invalid';
      const pending = footprints.get(domain) ?? health.check({ name: row?.name ?? vendorId, website: `https://${domain}` }, AbortSignal.timeout(40_000))
        .then(result => {
          const reachable = result.signals.some(signal => signal.type === 'website_reachable' && signal.value === true);
          const operating = result.signals.some(signal => signal.type === 'maps_status' && signal.value === 'operating');
          const ref = result.apifyRunId ? `apify:${result.apifyRunId}` : 'apify:unavailable';
          return { websiteReachable: reachable, listingOperating: operating, domain, evidenceRef: ref };
        })
        .catch(() => ({ websiteReachable: false, listingOperating: false, domain, evidenceRef: 'apify:unavailable' }));
      footprints.set(domain, pending);
      return pending;
    },
  } };
}
