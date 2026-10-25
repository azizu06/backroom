import { describe, expect, it } from 'vitest';
import { BOB_AMPLITUDE, STEP_DISTANCE } from '../playFeel';
import { ROLL_AMPLITUDE, SWAY_AMPLITUDE, createHeadBob, headBob } from './bob';

describe('head bob curve', () => {
  it('dips on each footfall and sways once per two steps', () => {
    const out = createHeadBob();
    headBob(0, 1, out);
    expect(out.y).toBeCloseTo(-BOB_AMPLITUDE);
    expect(out.x).toBeCloseTo(0);
    headBob(STEP_DISTANCE / 2, 1, out);
    expect(out.y).toBeCloseTo(BOB_AMPLITUDE);
    expect(out.x).toBeCloseTo(SWAY_AMPLITUDE);
    expect(out.roll).toBeCloseTo(ROLL_AMPLITUDE);
    headBob(STEP_DISTANCE * 1.5, 1, out);
    expect(out.x).toBeCloseTo(-SWAY_AMPLITUDE);
  });
  it('is subtle and scales with intensity', () => {
    const out = createHeadBob();
    for (let d = 0; d < 5; d += 0.05) {
      headBob(d, 1, out);
      expect(Math.abs(out.y)).toBeLessThanOrEqual(BOB_AMPLITUDE + 1e-12);
      expect(Math.abs(out.x)).toBeLessThanOrEqual(SWAY_AMPLITUDE + 1e-12);
      expect(Math.abs(out.roll)).toBeLessThan(0.01);
    }
    headBob(STEP_DISTANCE / 2, 0.5, out);
    expect(out.x).toBeCloseTo(SWAY_AMPLITUDE / 2);
  });
  it('is flat when the bob is off (reduced motion or the setting) and for bad input', () => {
    const out = createHeadBob();
    expect(headBob(1.3, 0, out)).toEqual({ y: 0, x: 0, roll: 0 });
    expect(headBob(Number.NaN, Number.NaN, out)).toEqual({ y: 0, x: 0, roll: 0 });
  });
  it('writes into the given object instead of allocating', () => {
    const out = createHeadBob();
    expect(headBob(0.4, 1, out)).toBe(out);
  });
});
