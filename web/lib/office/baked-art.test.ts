import { describe, expect, it } from 'vitest';
import { bakedArtRequested } from '../../app/office/mounts/BakedArt';

describe('baked art flag', () => {
  it('is off unless ?art=baked', () => {
    expect(bakedArtRequested('')).toBe(false);
    expect(bakedArtRequested('?perf=1')).toBe(false);
    expect(bakedArtRequested('?art=procedural')).toBe(false);
    expect(bakedArtRequested('?art=baked')).toBe(true);
    expect(bakedArtRequested('?perf=1&art=baked')).toBe(true);
  });
});
