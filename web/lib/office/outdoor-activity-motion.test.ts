import { describe, expect, it } from 'vitest';
import { BUILDING } from './layout';
import { PATH } from './outdoors';
import { CAR_COUNT, CAR_PERIOD, PEOPLE_COUNT, RAIN_COUNT, RAIN_PERIOD, WALK_PERIOD,
  carPosition, personHeading, personPosition, rainPosition } from './outdoor-activity-motion';

describe('outdoor activity routes', () => {
  it('keeps four walkers on continuous outdoor loops, with bounded bob and matching headings', () => {
    expect(PEOPLE_COUNT).toBe(4);
    for (let i = 0; i < PEOPLE_COUNT; i++) {
      for (let t = 0; t < WALK_PERIOD; t += 0.25) {
        const x = personPosition(t, i, 'x'), z = personPosition(t, i, 'z');
        expect(z).toBeGreaterThan(BUILDING.maxZ);
        if (i < 2) {
          expect(x).toBeGreaterThan(PATH.minX);
          expect(x).toBeLessThan(PATH.maxX);
          expect(z).toBeLessThan(PATH.maxZ);
        }
        expect(personPosition(t, i, 'y')).toBeGreaterThanOrEqual(0.025);
        expect(personPosition(t, i, 'y')).toBeLessThanOrEqual(0.095);
        for (const axis of ['x', 'y', 'z'] as const) {
          expect(personPosition(t + WALK_PERIOD, i, axis)).toBeCloseTo(personPosition(t, i, axis), 8);
          expect(Math.abs(personPosition(t + 1 / 12, i, axis) - personPosition(t, i, axis))).toBeLessThan(0.1);
        }
        const dx = personPosition(t + 0.001, i, 'x') - x, dz = personPosition(t + 0.001, i, 'z') - z;
        expect(Math.cos(personHeading(t, i)) * dz + Math.sin(personHeading(t, i)) * dx).toBeGreaterThan(0);
      }
    }
  });

  it('runs three cars on the street, slows near the entrance and wraps beyond the visible street', () => {
    expect(CAR_COUNT).toBe(3);
    for (let i = 0; i < CAR_COUNT; i++) {
      for (let t = 0; t < CAR_PERIOD; t++) {
        expect(Math.abs(carPosition(t, i, 'x'))).toBeLessThanOrEqual(120);
        expect(carPosition(t, i, 'z')).toBeGreaterThan(PATH.maxZ + 0.5);
        expect(carPosition(t, i, 'z')).toBeLessThan(PATH.maxZ + 6.5);
        expect(carPosition(t + CAR_PERIOD, i, 'x')).toBeCloseTo(carPosition(t, i, 'x'), 8);
      }
    }
    const centerSpeed = carPosition(50.1, 0, 'x') - carPosition(50, 0, 'x');
    const edgeSpeed = carPosition(10.1, 0, 'x') - carPosition(10, 0, 'x');
    expect(centerSpeed).toBeGreaterThan(0);
    expect(centerSpeed).toBeLessThan(edgeSpeed / 2);
    expect(carPosition(CAR_PERIOD - 0.001, 0, 'x')).toBeGreaterThan(119);
    expect(carPosition(CAR_PERIOD, 0, 'x')).toBe(-120);
  });

  it('falls gently in sparse repeatable columns outside the building', () => {
    for (let i = 0; i < RAIN_COUNT; i++) {
      const x = rainPosition(0, i, 'x'), z = rainPosition(0, i, 'z');
      expect(x < BUILDING.minX || x > BUILDING.maxX || z < BUILDING.minZ || z > BUILDING.maxZ).toBe(true);
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(rainPosition(RAIN_PERIOD, i, axis)).toBeCloseTo(rainPosition(0, i, axis), 8);
      }
      for (let t = 0; t < RAIN_PERIOD; t += 0.1) {
        const height = rainPosition(t, i, 'y');
        expect(height).toBeGreaterThanOrEqual(0.4);
        expect(height).toBeLessThanOrEqual(18.4);
        if (height > 0.5) expect(rainPosition(t + 0.01, i, 'y')).toBeCloseTo(height - 0.04, 8);
      }
    }
  });
});
