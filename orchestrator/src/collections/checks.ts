import type { CreditCheck, CreditResult, HealthCheck, HealthResult, HealthSignal, PublicCompany } from './types';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function publicUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000) return false;
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}

/** Project the Actor boundary; no raw scraped text enters audits or model input. */
export function projectHealthResult(value: unknown): HealthResult {
  if (!record(value) || !Array.isArray(value.signals) || value.signals.length > 100) throw new Error('Invalid health result');
  const signals: HealthSignal[] = value.signals.map((signal: unknown) => {
    if (!record(signal) || !publicUrl(signal.sourceUrl) || typeof signal.observedAt !== 'string'
      || signal.observedAt.length > 80 || !Number.isFinite(Date.parse(signal.observedAt))) throw new Error('Invalid health evidence');
    const evidence = { sourceUrl: signal.sourceUrl, observedAt: signal.observedAt };
    if (signal.type === 'maps_status' && ['operating', 'permanently_closed', 'temporarily_closed', 'unknown'].includes(signal.value as string)) {
      return { ...evidence, type: 'maps_status', value: signal.value as Extract<HealthSignal, { type: 'maps_status' }>['value'] };
    }
    if ((signal.type === 'distress_news' || signal.type === 'phone_match' || signal.type === 'website_reachable') && typeof signal.value === 'boolean') {
      return { ...evidence, type: signal.type, value: signal.value };
    }
    throw new Error('Invalid health signal');
  });
  return { signals, ...(typeof value.apifyRunId === 'string' && /^[a-zA-Z0-9]{1,100}$/.test(value.apifyRunId) ? { apifyRunId: value.apifyRunId } : {}) };
}

export async function boundedCreditCheck(check: CreditCheck, testIdentityId: number): Promise<CreditResult | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => check.check(testIdentityId)).catch(() => undefined),
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 40_000); }),
    ]);
    if (!result || result.testIdentityId !== testIdentityId || !['clear', 'hit', 'unknown'].includes(result.ofacStatus)) return;
    return { testIdentityId, ofacStatus: result.ofacStatus,
      activeSignals: result.activeSignals.filter(name => /^[a-z_]{1,80}$/.test(name)),
      evidence: result.evidence.map(evidence => ({ product: evidence.product, checkedAt: evidence.checkedAt,
        responseHash: evidence.responseHash, ...(evidence.creditScore === undefined ? {} : { creditScore: evidence.creditScore }) })),
    };
  } catch { return; }
  finally { clearTimeout(timer); }
}

/** Race, rather than abort alone: injected clients may ignore AbortSignal. */
export async function boundedHealthCheck(check: HealthCheck, company: PublicCompany): Promise<HealthResult | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>(resolve => {
    timer = setTimeout(() => { resolve(undefined); controller.abort(); }, 40_000);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => check.check(company, controller.signal)).then(projectHealthResult).catch(() => undefined),
      deadline,
    ]);
  } finally { clearTimeout(timer); }
}
