import { describe, expect, it } from 'vitest';
import { LOOK_SENSITIVITY } from '../play';
import { lookDelta, DEFAULT_PLAY_SETTINGS, SENSITIVITY_RANGE } from '../playSettings';
import { BASE_FOV } from '../playFeel';
import { LOOK_DAMP_RATE, SENSITIVITY_MAX, SENSITIVITY_MIN, lookDampFraction, sensitivityGain } from './look';

describe('sensitivity mapping', () => {
  it('is linear in the multiplier and clamps to the setting range', () => {
    expect(sensitivityGain(1)).toBe(LOOK_SENSITIVITY);
    expect(sensitivityGain(2)).toBeCloseTo(2 * LOOK_SENSITIVITY);
    expect(sensitivityGain(0.5)).toBeCloseTo(sensitivityGain(1) / 2);
    expect(sensitivityGain(99)).toBeCloseTo(SENSITIVITY_MAX * LOOK_SENSITIVITY);
    expect(sensitivityGain(-1)).toBeCloseTo(SENSITIVITY_MIN * LOOK_SENSITIVITY);
    expect(sensitivityGain(Number.NaN)).toBe(LOOK_SENSITIVITY);
  });
  it('is the one mapping the Play settings slider and pointer look share', () => {
    expect([SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max]).toEqual([SENSITIVITY_MIN, SENSITIVITY_MAX]);
    const [yaw] = lookDelta(10, 0, { ...DEFAULT_PLAY_SETTINGS, sensitivity: 2 });
    expect(yaw).toBeCloseTo(-10 * sensitivityGain(2));
  });
  it('has no acceleration: twice the movement turns exactly twice as far', () => {
    const [small] = lookDelta(5, 0, DEFAULT_PLAY_SETTINGS), [large] = lookDelta(50, 0, DEFAULT_PLAY_SETTINGS);
    expect(large).toBeCloseTo(small * 10);
  });
});

describe('look damping', () => {
  it('applies a frame-rate independent share and all of it without smoothing', () => {
    expect(lookDampFraction(1 / 60)).toBeCloseTo(1 - Math.exp(-LOOK_DAMP_RATE / 60));
    const twoHalves = 1 - (1 - lookDampFraction(1 / 120)) ** 2;
    expect(twoHalves).toBeCloseTo(lookDampFraction(1 / 60));
    expect(lookDampFraction(1 / 60, false)).toBe(1);
    expect(lookDampFraction(0)).toBe(0);
    expect(lookDampFraction(Number.NaN)).toBe(1);
  });
  it('settles on the full movement within a tenth of a second', () => {
    let pending = 1, applied = 0;
    for (let i = 0; i < 6; i++) { const take = pending * lookDampFraction(1 / 60); applied += take; pending -= take; }
    expect(applied).toBeGreaterThan(0.9);
    expect(applied).toBeLessThanOrEqual(1);
  });
  it('first person uses a 75° field of view', () => {
    expect(BASE_FOV).toBe(75);
  });
});
