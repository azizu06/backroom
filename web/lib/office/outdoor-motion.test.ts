import { describe, expect, it } from 'vitest';
import { BIRD_COUNT, BIRD_PERIOD, CLOUD_COUNT, CLOUD_PERIOD, OUTDOOR_FPS, birdPosition, cloudPosition,
  daylightBlend, outdoorMotionVisible, outdoorSway } from './outdoor-motion';
import { OUTDOOR } from './palette';

describe('outdoor motion', () => {
  it('keeps wind gentle, continuous, deterministic and spatially varied', () => {
    expect(outdoorSway(12, 3)).toBe(outdoorSway(12, 3));
    expect(outdoorSway(12, 3)).not.toBe(outdoorSway(12, 4));
    for (let t = 0; t < 600; t += 0.5) {
      expect(Math.abs(outdoorSway(t, 3))).toBeLessThanOrEqual(0.025);
      expect(Math.abs(outdoorSway(t + 1 / OUTDOOR_FPS, 3) - outdoorSway(t, 3))).toBeLessThan(0.002);
    }
  });

  it('drifts four separated clouds slowly on a seamless loop above the building', () => {
    expect(CLOUD_COUNT).toBeGreaterThanOrEqual(3);
    expect(CLOUD_COUNT).toBeLessThanOrEqual(5);
    for (let i = 0; i < CLOUD_COUNT; i++) {
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(cloudPosition(CLOUD_PERIOD, i, axis)).toBeCloseTo(cloudPosition(0, i, axis), 8);
        expect(Math.abs(cloudPosition(1, i, axis) - cloudPosition(0, i, axis))).toBeLessThan(0.8);
      }
      expect(cloudPosition(45, i, 'y')).toBeGreaterThan(30);
    }
    expect(cloudPosition(0, 0, 'x')).not.toBe(cloudPosition(0, 1, 'x'));
  });

  it('glides five distinct birds in a compact formation on a continuous high loop', () => {
    expect(BIRD_COUNT).toBeGreaterThanOrEqual(3);
    expect(BIRD_COUNT).toBeLessThanOrEqual(6);
    for (let t = 0; t < BIRD_PERIOD; t += 5) {
      for (let i = 0; i < BIRD_COUNT; i++) {
        let distanceSquared = 0;
        for (const axis of ['x', 'y', 'z'] as const) {
          const position = birdPosition(t, i, axis);
          expect(birdPosition(t + BIRD_PERIOD, i, axis)).toBeCloseTo(position, 8);
          expect(Math.abs(birdPosition(t + 1 / OUTDOOR_FPS, i, axis) - position)).toBeLessThan(0.2);
          distanceSquared += (position - birdPosition(t, 0, axis)) ** 2;
        }
        expect(birdPosition(t, i, 'y')).toBeGreaterThan(20);
        if (i > 0) expect(distanceSquared).toBeGreaterThan(0.5);
        expect(distanceSquared).toBeLessThan(30);
      }
    }
  });

  it('keeps daylight subtle and bounded between bright tokens over ten minutes', () => {
    expect(daylightBlend(0)).toBe(0);
    expect(daylightBlend(300)).toBe(1);
    expect(daylightBlend(600)).toBe(0);
    for (let t = 0; t < 600; t++) {
      expect(daylightBlend(t)).toBeGreaterThanOrEqual(0);
      expect(daylightBlend(t)).toBeLessThanOrEqual(1);
      expect(Math.abs(daylightBlend(t + 1) - daylightBlend(t))).toBeLessThan(0.006);
    }
    for (const token of [OUTDOOR.skyTint, OUTDOOR.skyTintWarm, OUTDOOR.sun, OUTDOOR.sunWarm]) {
      for (const channel of [1, 3, 5]) expect(parseInt(token.slice(channel, channel + 2), 16)).toBeGreaterThanOrEqual(160);
    }
  });

  it('allows outdoor frames only in overview, outside or near a window', () => {
    expect(outdoorMotionVisible(true, 0, 0)).toBe(true);
    expect(outdoorMotionVisible(false, 0, 0)).toBe(false);
    expect(outdoorMotionVisible(false, 3, 0)).toBe(false);
    expect(outdoorMotionVisible(false, -11, -6)).toBe(true);
    expect(outdoorMotionVisible(false, 11, 6)).toBe(true);
    expect(outdoorMotionVisible(false, -0.8, -6)).toBe(true);
    expect(outdoorMotionVisible(false, 0, 20)).toBe(true);
  });
});
