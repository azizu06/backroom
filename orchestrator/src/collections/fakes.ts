import type { CreditCheck, CreditResult, HealthCheck, HealthResult } from './types';

/** Explicit synthetic dependencies for offline demos/tests. Never presented as live evidence. */
export function fakeCreditCheck(result: CreditResult): CreditCheck {
  return { async check(id) {
    if (id !== result.testIdentityId) throw new Error('No fake for this test identity');
    return structuredClone(result);
  } };
}
export function fakeHealthCheck(result: HealthResult): HealthCheck {
  return { async check() { return structuredClone(result); } };
}
