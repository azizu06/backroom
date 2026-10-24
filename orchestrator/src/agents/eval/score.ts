/** Scoring is separate from execution: an external AgentRuntime can supply the same observations. */
export interface Observation {
  id: string;
  expected: 'ALLOW' | 'HOLD';
  actual: 'ALLOW' | 'HOLD' | 'ERROR';
  fraud?: boolean;
  duplicate?: boolean;
}
export function score(observations: readonly Observation[]) {
  const rate = (numerator: number, denominator: number) => ({ numerator, denominator,
    percent: denominator ? Number((100 * numerator / denominator).toFixed(2)) : null });
  const holds = observations.filter(row => row.expected === 'HOLD');
  const allows = observations.filter(row => row.expected === 'ALLOW');
  const fraud = observations.filter(row => row.fraud);
  const duplicates = observations.filter(row => row.duplicate);
  return {
    decisions: rate(observations.filter(row => row.actual === row.expected).length, observations.length),
    holdCatch: rate(holds.filter(row => row.actual === 'HOLD').length, holds.length),
    fraudCatch: rate(fraud.filter(row => row.actual === 'HOLD').length, fraud.length),
    duplicateCatch: rate(duplicates.filter(row => row.actual === 'HOLD').length, duplicates.length),
    falseHolds: rate(allows.filter(row => row.actual === 'HOLD').length, allows.length),
    errors: observations.filter(row => row.actual === 'ERROR').map(row => row.id),
    disagreements: observations.filter(row => row.actual !== row.expected),
  };
}
