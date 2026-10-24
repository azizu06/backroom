// @vitest-environment node
import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { mergeBoxes } from '../../app/office/mounts/StaticGeometry';
import { deskPieces } from './furniture';

describe('merged static geometry', () => {
  it('rejects an empty batch before allocating geometry', () => {
    expect(() => mergeBoxes([])).toThrow(RangeError);
  });

  it('preserves transformed bounds, normals, triangle count and linear vertex colours in one draw group', () => {
    const geometry = mergeBoxes([
      { at: [2, 3, 4], size: [2, 4, 6], color: '#a9bc8f' },
      { at: [-2, 0, 0], size: [2, 4, 6], color: '#ed6252', rotation: [0, 0, Math.PI / 2] },
    ]);
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.toArray()).toEqual([-4, -1, -3]);
    expect(geometry.boundingBox!.max.toArray()).toEqual([3, 5, 7]);
    expect(geometry.index!.count / 3).toBe(24);
    expect(geometry.groups).toEqual([]);
    const colors = geometry.getAttribute('color'), normals = geometry.getAttribute('normal');
    for (const [vertex, hex] of [[0, '#a9bc8f'], [24, '#ed6252']] as const) {
      const expected = new Color(hex);
      expect(colors.getX(vertex)).toBeCloseTo(expected.r);
      expect(colors.getY(vertex)).toBeCloseTo(expected.g);
      expect(colors.getZ(vertex)).toBeCloseTo(expected.b);
      expect(Math.hypot(normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex))).toBeCloseTo(1);
    }
    geometry.dispose();
  });

  it('bakes all eight desk parts without dropping faces', () => {
    const geometry = mergeBoxes(deskPieces('dana'));
    expect(geometry.index!.count / 3).toBe(8 * 12);
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(1);
    geometry.dispose();
  });
});
