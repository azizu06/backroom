import { describe, expect, it } from 'vitest';
import { DRESSING, dressingBoxes, dressingColliders, dressingFor, polylineLength, routeArrow, routeDashes, ROUTE_DASH, ROUTE_GAP, type FloorPoint, type PaintSegment } from './dressing';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type AnchorId } from '../state';
const length = ([a, b]: readonly [FloorPoint, FloorPoint]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const segLength = (segment: PaintSegment) => length([segment.from, segment.to]);

describe('open workspace dressing', () => {
  it('detaches partition signs, shelves, indoor planters and obsolete painted room routes together', () => {
    expect(DRESSING).toEqual({ shelves: [], plants: [], signs: [], routes: [] });
    expect(dressingFor({ ...INITIAL_OFFICE, rooms: undefined })).toEqual(DRESSING);
    expect(dressingBoxes(DRESSING)).toEqual([]);
    expect(dressingColliders(Object.keys(OFFICE_ANCHORS) as AnchorId[])).toEqual([]);
  });
});

/** Joins pieces that continue one another (a dash split at a corner) back into whole dashes. */
function wholeDashes(pieces: PaintSegment[]): number[] {
  const out: number[] = [];
  pieces.forEach((piece, i) => {
    const previous = pieces[i - 1];
    if (previous && length([previous.to, piece.from]) < 1e-9) out[out.length - 1]! += segLength(piece);
    else out.push(segLength(piece));
  });
  return out;
}

describe('routeDashes', () => {
  it('covers a straight line with the expected count', () => {
    const line: FloorPoint[] = [[0, 0], [3, 0]];
    const dashes = routeDashes(line, 0.3, 0.2);
    expect(dashes).toHaveLength(6);
    expect(dashes[0]).toEqual({ from: [0, 0], to: [0.3, 0] });
    expect(dashes.reduce((sum, s) => sum + segLength(s), 0)).toBeCloseTo(1.8);
    const longer = routeDashes([[0, 0], [3.1, 0]], 0.3, 0.2);
    expect(longer).toHaveLength(7);
    expect(segLength(longer.at(-1)!)).toBeCloseTo(0.1);
    expect(longer.at(-1)!.to[0]).toBeCloseTo(3.1);
  });

  it('runs the pattern on across corners, splitting a dash at the corner', () => {
    const pieces = routeDashes([[0, 0], [1, 0], [1, 1]], 0.5, 0.2);
    expect(pieces).toHaveLength(4);
    expect(pieces[1]!.to).toEqual([1, 0]);
    expect(pieces[2]!.from).toEqual([1, 0]);
    expect(pieces[2]!.to[1]).toBeCloseTo(0.2);
    expect(wholeDashes(pieces).map(n => +n.toFixed(6))).toEqual([0.5, 0.5, 0.5]);
  });

  it('covers every route polyline: count, painted length and reach to the end', () => {
    const period = ROUTE_DASH + ROUTE_GAP;
    for (const { points, to } of DRESSING.routes) {
      const total = polylineLength(points);
      const pieces = routeDashes(points, ROUTE_DASH, ROUTE_GAP);
      const whole = Math.floor(total / period), rest = total - whole * period;
      const expected = whole + (rest > 1e-9 ? 1 : 0);
      expect(wholeDashes(pieces), to).toHaveLength(expected);
      const painted = whole * ROUTE_DASH + Math.min(ROUTE_DASH, rest);
      expect(pieces.reduce((sum, s) => sum + segLength(s), 0), to).toBeCloseTo(painted, 6);
      expect(pieces[0]!.from, to).toEqual(points[0]);
      expect(length([pieces.at(-1)!.to, points.at(-1)!]), to).toBeLessThanOrEqual(ROUTE_GAP + 1e-9);
      for (const piece of pieces) expect(segLength(piece)).toBeLessThanOrEqual(ROUTE_DASH + 1e-9);
    }
  });

  it('skips zero-length segments and rejects a bad pattern', () => {
    expect(routeDashes([[0, 0], [0, 0], [1, 0]], 0.3, 0.2)).toHaveLength(2);
    expect(routeDashes([[0, 0]], 0.3, 0.2)).toEqual([]);
    expect(() => routeDashes([[0, 0], [1, 0]], 0, 0.2)).toThrow(RangeError);
    expect(() => routeDashes([[0, 0], [1, 0]], 0.3, -1)).toThrow(RangeError);
  });

  it('points the end chevron along the last segment', () => {
    const [left, right] = routeArrow([[0, 0], [0, -2]], 0.3);
    for (const arm of [left!, right!]) {
      expect(arm.from).toEqual([0, -2]);
      expect(arm.to[1]).toBeCloseTo(-2 + 0.3 * Math.SQRT1_2);
      expect(Math.abs(arm.to[0])).toBeCloseTo(0.3 * Math.SQRT1_2);
    }
    expect(Math.sign(left!.to[0])).toBe(-Math.sign(right!.to[0]));
    expect(routeArrow([[1, 1]], 0.3)).toEqual([]);
  });
});
