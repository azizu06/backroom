import { describe, expect, it } from 'vitest';
import { FrameAverage, officePerfEnabled } from './perf';

describe('office perf', () => {
  it('requires explicit opt-in', () => {
    for (const search of ['', '?perf=0', '?perf=true', '?other=1']) expect(officePerfEnabled(search)).toBe(false);
    expect(officePerfEnabled('?view=walk&perf=1')).toBe(true);
  });

  it('averages rendered samples and rolls over its bounded window', () => {
    const average = new FrameAverage(3);
    expect(average.add(4)).toBe(4);
    expect(average.add(8)).toBe(6);
    expect(average.add(12)).toBe(8);
    expect(average.add(16)).toBe(12);
    expect(average.add(0)).toBeCloseTo(28 / 3);
  });

  it('ignores invalid durations and rejects invalid window sizes', () => {
    const average = new FrameAverage();
    expect(average.add(NaN)).toBe(0);
    average.add(5);
    for (const ms of [Infinity, -1, NaN]) expect(average.add(ms)).toBe(5);
    for (const size of [0, -1, 1.5, Infinity]) expect(() => new FrameAverage(size)).toThrow(RangeError);
  });
});
