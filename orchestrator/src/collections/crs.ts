import type { CrsClient, CrsEvidence } from '../integrations/crs';
import { createCrsClientFromEnv } from '../integrations/crs/sandbox';
import type { CreditCheck } from './types';

/** Only exported sponsor APIs; counts conservatively stop even discharged/unspecified bankruptcies. */
export function createCrsPublicRecordsCheck(client: Pick<CrsClient, 'getPublicRecords'>): CreditCheck {
  return { label: 'CRS sandbox', async check(testIdentityId) {
    const evidence = await client.getPublicRecords(testIdentityId);
    assertCrsEvidence(evidence, 'publicRecords', testIdentityId);
    const count = evidence.summary.bankruptcies;
    if (!Number.isSafeInteger(count) || count! < 0) throw new Error('Invalid CRS bankruptcy count');
    return { testIdentityId, ofacStatus: 'unknown', ofacAvailability: 'not available in sandbox',
      bankruptcy: count! > 0, activeSignals: [], evidence: [{ product: 'publicRecords',
        checkedAt: evidence.checkedAt, responseHash: evidence.responseHash, bankruptcies: count }] };
  } };
}

/** Shared validation of projected evidence; provider labels and extra fields are never persisted. */
export function assertCrsEvidence(value: CrsEvidence, product: CrsEvidence['product'], id: number): void {
  if (!Number.isSafeInteger(id) || id < 1 || value.label.startsWith('FAKE') || value.source !== 'crs_sandbox' || value.product !== product || value.testIdentityId !== id ||
      !/^[a-f0-9]{64}$/.test(value.responseHash) || !Number.isFinite(Date.parse(value.checkedAt))) throw new Error('Invalid CRS evidence');
}

/** No network by default. Fake clearance is explicitly synthetic, never a sandbox OFAC result. */
export function createPreCallCreditCheck(env: NodeJS.ProcessEnv = process.env, http?: typeof fetch): CreditCheck {
  if (env.PRECALL_CRS !== 'live') return { label: 'FAKE', async check(testIdentityId) {
    return { testIdentityId, ofacStatus: 'clear', activeSignals: [], evidence: [] };
  } };
  const client = createCrsClientFromEnv(env, http);
  if (!client) return { label: 'CRS sandbox', async check() { throw new Error('CRS credentials unavailable'); } };
  return createCrsPublicRecordsCheck(client);
}
