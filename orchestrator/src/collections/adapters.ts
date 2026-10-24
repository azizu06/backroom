import { projectHealthResult } from './checks';
import type { CreditCheck, CreditEvidence, HealthCheck, PublicCompany } from './types';

/** Structural subset of the CRS worker's exported client API; no endpoint is guessed here. */
interface CrsEvidenceForPreCall {
  source: 'crs_sandbox' | 'crs_fixture'; product: 'businessCredit' | 'ofac'; testIdentityId: number;
  label: string; checkedAt: string; responseHash: string;
  summary: { creditScore?: number; ofacStatus?: 'clear' | 'hit' | 'unknown' };
}
export interface CrsClientApi {
  getBusinessCreditReport(testIdentityId: number): Promise<CrsEvidenceForPreCall>;
  checkOfac(testIdentityId: number): Promise<CrsEvidenceForPreCall>;
}

/** Unknown sponsor semantics remain unknown. Score thresholds come only from owner configuration. */
export function createCrsCreditCheck(client: CrsClientApi, scoreSignals: (score: number | undefined) => readonly string[] = () => []): CreditCheck {
  return {
    async check(testIdentityId) {
      if (!Number.isSafeInteger(testIdentityId) || testIdentityId < 1) throw new Error('Approved CRS test identity required');
      const [credit, ofac] = await Promise.allSettled([
        client.getBusinessCreditReport(testIdentityId), client.checkOfac(testIdentityId),
      ]);
      const valid = (result: PromiseSettledResult<CrsEvidenceForPreCall>, product: CrsEvidenceForPreCall['product']) => {
        if (result.status !== 'fulfilled') return;
        const value = result.value;
        if (value.label.startsWith('FAKE') || value.source !== 'crs_sandbox' || value.testIdentityId !== testIdentityId || value.product !== product
          || !/^[a-f0-9]{64}$/.test(value.responseHash) || !Number.isFinite(Date.parse(value.checkedAt))) return;
        return value;
      };
      const creditResult = valid(credit, 'businessCredit');
      const ofacResult = valid(ofac, 'ofac');
      const status = ofacResult?.summary.ofacStatus;
      const ofacStatus = status === 'hit' ? 'hit' : creditResult && status === 'clear' ? 'clear' : 'unknown';
      const score = creditResult?.summary.creditScore;
      const creditScore = typeof score === 'number' && Number.isFinite(score) ? score : undefined;
      const evidence: CreditEvidence[] = [creditResult, ofacResult].filter(value => !!value).map(value => ({
        product: value.product, checkedAt: value.checkedAt, responseHash: value.responseHash,
        ...(value.product === 'businessCredit' && creditScore !== undefined ? { creditScore } : {}),
      }));
      return { testIdentityId, ofacStatus, activeSignals: scoreSignals(creditScore), evidence };
    },
  };
}

/** Bind Tomi's Actor runner after its exported transport lands; input is the real public company. */
export function createApifyHealthCheck(runActor: (company: PublicCompany, signal: AbortSignal) => Promise<unknown>): HealthCheck {
  return { async check(company, signal) { return projectHealthResult(await runActor(company, signal)); } };
}
