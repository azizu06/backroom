/** CPU time spent on rendered frames only; idle demand-loop gaps never enter the window. */
export class FrameAverage {
  private readonly samples: Float64Array;
  private cursor = 0;
  private count = 0;
  private total = 0;

  constructor(size = 60) {
    if (!Number.isInteger(size) || size < 1) throw new RangeError('Frame window must be a positive integer');
    this.samples = new Float64Array(size);
  }

  add(ms: number): number {
    if (Number.isFinite(ms) && ms >= 0) {
      this.total += ms - this.samples[this.cursor]!;
      this.samples[this.cursor] = ms;
      this.cursor = (this.cursor + 1) % this.samples.length;
      this.count = Math.min(this.count + 1, this.samples.length);
    }
    return this.count ? this.total / this.count : 0;
  }
}

export function officePerfEnabled(search: string): boolean {
  return new URLSearchParams(search).get('perf') === '1';
}
