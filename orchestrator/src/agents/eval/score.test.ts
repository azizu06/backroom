import { expect, it } from 'vitest';
import { score } from './score';

it('keeps missed traps, false holds and errors in the denominators', () => {
  const result = score([
    { id: 'fraud-missed', expected: 'HOLD', actual: 'ALLOW', fraud: true },
    { id: 'duplicate-caught', expected: 'HOLD', actual: 'HOLD', duplicate: true },
    { id: 'clean-held', expected: 'ALLOW', actual: 'HOLD' },
    { id: 'failed', expected: 'ALLOW', actual: 'ERROR' },
  ]);
  expect(result.decisions).toEqual({ numerator: 1, denominator: 4, percent: 25 });
  expect(result.holdCatch.percent).toBe(50);
  expect(result.fraudCatch.percent).toBe(0);
  expect(result.duplicateCatch.percent).toBe(100);
  expect(result.falseHolds.percent).toBe(50);
  expect(result.disagreements.map(row => row.id)).toEqual(['fraud-missed', 'clean-held', 'failed']);
  expect(result.errors).toEqual(['failed']);
  expect(score([]).fraudCatch.percent).toBeNull();
});
