import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CrsEvidence } from '../../integrations/crs';
import { createCrsPublicRecordsCheck } from '../../collections/crs';
import { inputFileSha256 } from './provenance';

export const CRS_RECEIPT_PATH = 'docs/evidence/crs/live-run.json';

/** Replay a committed, projected sandbox response through the actual adapter.
 * This identity is the recorded public-records persona, never a mapped OFAC identity. */
export async function replayRecordedCrsCoverage() {
  const bytes = readFileSync(fileURLToPath(new URL(`../../../../${CRS_RECEIPT_PATH}`, import.meta.url)));
  const receipt = JSON.parse(bytes.toString('utf8')) as {
    measuredAt: string; evidence: Record<string, CrsEvidence>;
  };
  const evidence = receipt.evidence.publicRecords;
  if (!evidence) throw new Error('CRS_RECORDED_PUBLIC_RECORDS_MISSING');
  const credit = createCrsPublicRecordsCheck({ getPublicRecords: async id => {
    if (id !== evidence.testIdentityId) throw new Error('CRS_REPLAY_IDENTITY_MISMATCH');
    return structuredClone(evidence);
  } });
  const result = await credit.check(evidence.testIdentityId);
  return {
    receiptPath: CRS_RECEIPT_PATH, receiptSha256: inputFileSha256(bytes), recordedAt: receipt.measuredAt,
    recordedProducts: Object.values(receipt.evidence).map(row => row.product).sort(),
    recordedTestIdentityId: evidence.testIdentityId,
    recordedOfacEvidence: Object.values(receipt.evidence).some(row => row.product === 'ofac'),
    replay: { ofacStatus: result.ofacStatus, ofacAvailability: result.ofacAvailability, bankruptcy: result.bankruptcy },
    networkCalls: 0,
    scope: 'Offline replay of a committed CRS public-records projection through createCrsPublicRecordsCheck; not a new CRS request. Recorded identity #6 has bankruptcy evidence, not OFAC evidence. No identity mapping or live sanctions response for P07 is proved.',
  };
}
