import { evaluate, type Decision } from '@backroom/policy';
import type { CrsClient } from '../integrations/crs';
import { createCrsClientFromEnv } from '../integrations/crs/sandbox';
import { assertCrsEvidence } from '../collections/crs';
import { hold } from '../payables/decisions';
import seed from '../../../fixtures/company/northfield.json';

export interface BankChangeRisk {
  check(vendorId: string): Promise<{ score: number; label: string; checkedAt?: string; responseHash?: string }>;
}
/** Resolver is server-owned master/fixture configuration, never an extracted/request identity. */
export function createCrsBankChangeRisk(client: Pick<CrsClient, 'getFraudRisk'>, identityForVendor: (vendorId: string) => number | undefined): BankChangeRisk {
  return { async check(vendorId) {
    const id = identityForVendor(vendorId);
    if (!Number.isSafeInteger(id) || id! < 1) throw new Error('Approved CRS vendor mapping required');
    const evidence = await client.getFraudRisk(id!);
    assertCrsEvidence(evidence, 'fraudRisk', id!);
    const score = evidence.summary.fraudRiskScore;
    if (score === undefined || !Number.isFinite(score) || score < 0 || score > 100) throw new Error('Invalid CRS fraud risk');
    return { score, label: `CRS sandbox: test identity #${id}`, checkedAt: evidence.checkedAt, responseHash: evidence.responseHash };
  } };
}
const seedIdentity = (vendorId: string): number | undefined => {
  const mapping = seed.vendors.find(vendor => vendor.id === vendorId)?.crsIdentityMapping;
  return mapping?.status === 'mapped' && typeof mapping.sandboxIdentityId === 'number' ? mapping.sandboxIdentityId : undefined;
};
export function createBankChangeRiskCheck(options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; identityForVendor?: (vendorId: string) => number | undefined } = {}): BankChangeRisk {
  const env = options.env ?? process.env;
  if (env.VENDOR_CRS !== 'live') return { async check() { return { score: 0, label: 'FAKE: synthetic fraud risk (not checked)' }; } };
  const client = createCrsClientFromEnv(env, options.fetch);
  if (!client) return { async check() { throw new Error('CRS credentials unavailable'); } };
  return createCrsBankChangeRisk(client, options.identityForVendor ?? seedIdentity);
}

/** Sanitize again at the seat boundary, even for an injected adapter. Unavailable never clears a hold. */
export async function assessBankChangeRisk(check: BankChangeRisk, vendorId: string, knownDomain: string): Promise<{ decision?: Decision; inputs: Record<string, unknown>; refs: string[] }> {
  try {
    const result = await check.check(vendorId);
    if (!Number.isFinite(result.score) || result.score < 0 || result.score > 100 ||
        !/^(CRS sandbox: test identity #[1-9][0-9]*|FAKE: synthetic fraud risk \(not checked\))$/.test(result.label)) throw new Error('Invalid risk');
    if (result.label.startsWith('CRS sandbox') && (!result.responseHash || !/^[a-f0-9]{64}$/.test(result.responseHash) || !result.checkedAt || !Number.isFinite(Date.parse(result.checkedAt)))) throw new Error('Invalid evidence');
    const decision = evaluate('vendor_onboarding', { type: 'propose_bank_change', emailDomain: knownDomain }, {
      vendor: { id: vendorId, knownDomain, inMaster: true, approved: true, pendingBankChange: true }, signals: { fraudRiskScore: result.score },
    });
    return { ...(decision.ruleIds.includes('FRAUD_RISK_HOLD') ? { decision } : {}),
      inputs: { label: result.label, fraudRiskScore: result.score, checkedAt: result.checkedAt, responseHash: result.responseHash },
      refs: result.responseHash ? [`crs:sha256:${result.responseHash}`] : [] };
  } catch { return { decision: hold('INVALID_INPUT'), inputs: { label: 'CRS sandbox: fraud risk unavailable' }, refs: [] }; }
}
