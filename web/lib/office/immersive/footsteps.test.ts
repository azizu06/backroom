import { describe, expect, it } from 'vitest';
import { REFERENCE_SPEED, STEP_DISTANCE } from '../playFeel';
import { FOOTSTEP_VOICES, footstepCadence, footstepInterval, footstepLevel, footstepVoice } from './footsteps';

describe('footstep cadence', () => {
  it('follows the speed, one footfall per stride', () => {
    expect(footstepCadence(REFERENCE_SPEED)).toBeCloseTo(REFERENCE_SPEED / STEP_DISTANCE);
    expect(footstepCadence(REFERENCE_SPEED * 2)).toBeCloseTo(footstepCadence(REFERENCE_SPEED) * 2);
    expect(footstepInterval(REFERENCE_SPEED)).toBeCloseTo(STEP_DISTANCE / REFERENCE_SPEED);
    // A normal walk is roughly 2 to 4 steps a second.
    expect(footstepCadence(REFERENCE_SPEED)).toBeGreaterThan(2);
    expect(footstepCadence(REFERENCE_SPEED)).toBeLessThan(4);
  });
  it('is silent when standing or given bad input', () => {
    for (const speed of [0, -1, Number.NaN, Infinity * 0]) {
      expect(footstepCadence(speed)).toBe(0);
      expect(footstepInterval(speed)).toBe(Infinity);
    }
  });
  it('is quieter when shuffling than at a full walk', () => {
    expect(footstepLevel(0.3)).toBeLessThan(footstepLevel(REFERENCE_SPEED));
    expect(footstepLevel(REFERENCE_SPEED)).toBe(1);
    expect(footstepLevel(REFERENCE_SPEED * 3)).toBe(1);
    expect(footstepLevel(Number.NaN)).toBeCloseTo(0.55);
  });
});

describe('footstep timbre by floor', () => {
  it('gives each floor its own sound: hard floors click, soft ones do not', () => {
    const { carpet, wood, tile, grass } = FOOTSTEP_VOICES;
    expect(tile.clickGain).toBeGreaterThan(wood.clickGain);
    expect(wood.clickGain).toBeGreaterThan(carpet.clickGain);
    expect(grass.clickGain).toBe(0);
    expect(carpet.noiseFilter).toBe('lowpass');
    expect(tile.noiseHz).toBeGreaterThan(carpet.noiseHz);
    expect(grass.noiseDecay).toBeGreaterThan(tile.noiseDecay);
    expect(new Set(Object.values(FOOTSTEP_VOICES).map(voice => voice.bodyHz)).size).toBe(4);
  });
  it('keeps every voice short and audible', () => {
    for (const voice of Object.values(FOOTSTEP_VOICES)) {
      expect(voice.bodyDecay).toBeLessThan(0.2);
      expect(voice.noiseDecay).toBeLessThan(0.2);
      expect(voice.bodyEndHz).toBeLessThan(voice.bodyHz);
      expect(voice.bodyGain + voice.noiseGain).toBeGreaterThan(0.3);
    }
    expect(footstepVoice('tile')).toBe(FOOTSTEP_VOICES.tile);
  });
});
