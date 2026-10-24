import { describe, expect, it } from 'vitest';
import { PLAY_INTRO_MS, interpolateIntroPose, interpolateQuaternion, playIntroProgress, type IntroPose, type Quaternion } from './play-intro';

const yawQuaternion = (yaw: number): Quaternion => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
const yawOf = (q: Quaternion) => 2 * Math.atan2(q[1], q[3]);
const from: IntroPose = { position: [13, 15, 17], quaternion: yawQuaternion(1) };
const to: IntroPose = { position: [-5, 1.55, 0.9], quaternion: yawQuaternion(0) };

describe('Play intro', () => {
  it('clamps the endpoints and eases monotonically over 900 ms', () => {
    expect(PLAY_INTRO_MS).toBe(900);
    expect(playIntroProgress(-100, false)).toBe(0);
    expect(playIntroProgress(0, false)).toBe(0);
    expect(playIntroProgress(PLAY_INTRO_MS, false)).toBe(1);
    expect(playIntroProgress(2000, false)).toBe(1);
    let previous = 0;
    for (let elapsed = 0; elapsed <= PLAY_INTRO_MS; elapsed += 10) {
      const progress = playIntroProgress(elapsed, false);
      expect(progress).toBeGreaterThanOrEqual(previous);
      expect(progress).toBeLessThanOrEqual(1);
      previous = progress;
    }
    expect(playIntroProgress(PLAY_INTRO_MS / 4, false)).toBeLessThan(0.25);
    expect(playIntroProgress(PLAY_INTRO_MS * 3 / 4, false)).toBeGreaterThan(0.75);
  });

  it('switches instantly under reduced motion, including before the first frame', () => {
    for (const elapsed of [-1, 0, 1, 450, 900]) {
      const progress = playIntroProgress(elapsed, true);
      expect(progress).toBe(1);
      expect(interpolateIntroPose(from, to, progress)).toEqual(to);
    }
  });

  it('interpolates position and orientation with exact endpoints', () => {
    expect(interpolateIntroPose(from, to, -1)).toEqual(from);
    expect(interpolateIntroPose(from, to, 2)).toEqual(to);
    const halfway = interpolateIntroPose(from, to, 0.5);
    expect(halfway.position).toEqual([4, (15 + 1.55) / 2, (17 + 0.9) / 2]);
    expect(yawOf(halfway.quaternion)).toBeCloseTo(0.5);
  });

  it.each([1, -1])('takes the shortest yaw arc across +/-PI (%s)', sign => {
    const start = yawQuaternion(sign * Math.PI * 179 / 180);
    const end = yawQuaternion(-sign * Math.PI * 179 / 180);
    const middle = interpolateQuaternion(start, end, 0.5);
    expect(Math.abs(yawOf(middle))).toBeCloseTo(Math.PI);
    const finish = interpolateQuaternion(start, end, 1);
    expect(Math.abs(finish.reduce((dot, value, i) => dot + value * end[i]!, 0))).toBeCloseTo(1);
  });

  it('keeps equivalent opposite quaternions still and nearby rotations normalized', () => {
    const q = yawQuaternion(1.2);
    const opposite: Quaternion = [-q[0], -q[1], -q[2], -q[3]];
    expect(interpolateQuaternion(q, opposite, 0.5)).toEqual(q);
    const nearby = interpolateQuaternion(q, yawQuaternion(1.2001), 0.4);
    expect(Math.hypot(...nearby)).toBeCloseTo(1);
    expect(yawOf(nearby)).toBeCloseTo(1.20004);
    // A tilted/rolled overview also follows a normalized 3D arc to the eye pose.
    expect(Math.hypot(...interpolateQuaternion([0.5, 0.5, 0.5, 0.5], to.quaternion, 0.5))).toBeCloseTo(1);
  });
});
