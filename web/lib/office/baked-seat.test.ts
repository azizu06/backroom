import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_LOCAL, SEAT_CLEARANCE_M, SEAT_LOCAL, CHAIR_SEAT_TOP, WORKSTATION_SEATS, seatAtApproach, BEAR_SEAT_LIFT, SIT_LIFT_M, angleDelta, deskSeat, easeSeat, headingToward, seatPieces,
  stepSeatBlend, turnToward, SIT_SECONDS,
} from './baked-seat';
import { PALETTE } from './palette';
import { OFFICE_ANCHORS } from './state';
import { DESK_SIZE } from './targets/desk';
import { CHAIR_FOOTPRINT } from './metrics';
import { WORKSTATIONS, workstationApproach } from './layout';
import { workstationPieces } from './furniture';
import { BEAR, BEAR_HEIGHT } from './bear';

const palette = new Set<string>(Object.values(PALETTE));

describe('deskSeat', () => {
  it.each(['collections', 'payables', 'vendor_onboarding'] as const)('seats %s between its anchor and its desk, facing the keys', room => {
    const seat = deskSeat(room)!;
    const [ax, az] = OFFICE_ANCHORS[room].position;
    const [cx, cz] = OFFICE_ANCHORS[room].center;
    expect(seat.x).toBeCloseTo(cx + SEAT_LOCAL.x);
    expect(seat.z).toBeCloseTo(cz + SEAT_LOCAL.z);
    // Closer to the desk than the anchor, still outside the desk's front edge.
    expect(seat.z).toBeLessThan(az);
    expect(seat.z).toBeGreaterThan(cz + DESK_SIZE.depth / 2);
    expect(Math.hypot(seat.x - ax, seat.z - az)).toBeLessThan(Math.hypot(cx - ax, cz - az));
    // Heading PI faces -z, toward the desk.
    expect(Math.abs(angleDelta(seat.heading, Math.PI))).toBeLessThan(1e-9);
  });

  it('mirrors the seat for Dana’s turned desk', () => {
    const seat = deskSeat('dana')!;
    const [cx, cz] = OFFICE_ANCHORS.dana.center;
    expect(seat.x).toBeCloseTo(cx - SEAT_LOCAL.x);
    expect(seat.z).toBeCloseTo(cz - SEAT_LOCAL.z);
    expect(seat.heading).toBeCloseTo(0);
  });

  it('has no seat for rooms without a desk or unknown ids', () => {
    expect(deskSeat('lobby')).toBeNull();
    expect(deskSeat('treasury')).toBeNull();
    expect(deskSeat('__proto__')).toBeNull();
  });

  it('keeps the body clear of the desk edge with the keys within reach', () => {
    expect(SEAT_CLEARANCE_M).toBeGreaterThanOrEqual(0.19);
    const reach = SEAT_LOCAL.z - KEYBOARD_LOCAL.z;
    expect(reach).toBeGreaterThan(0.28);
    expect(reach).toBeLessThan(0.5);
    expect(KEYBOARD_LOCAL.z + KEYBOARD_LOCAL.depth / 2).toBeLessThanOrEqual(DESK_SIZE.depth / 2);
  });
});

describe('facing math', () => {
  it('uses the avatar heading convention (0 faces +z, atan2(dx, dz))', () => {
    expect(headingToward(0, 0, 0, 1)).toBeCloseTo(0);
    expect(headingToward(0, 0, 1, 0)).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(headingToward(0, 0, 0, -1))).toBeCloseTo(Math.PI);
  });

  it('wraps the shortest signed turn', () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI);
    expect(angleDelta(0, 4 * Math.PI)).toBeCloseTo(0);
  });

  it('turns smoothly the short way, and snaps under reduced motion', () => {
    const next = turnToward(3, -3, 1 / 60, false);
    expect(next).toBeGreaterThan(3);
    expect(next - 3).toBeLessThan(2 * Math.PI - 6);
    expect(turnToward(3, -3, 1 / 60, true)).toBe(-3);
    let heading = 0;
    for (let i = 0; i < 120; i++) heading = turnToward(heading, 2, 1 / 60, false);
    expect(heading).toBeCloseTo(2, 3);
    expect(turnToward(1, 2, -1, false)).toBe(1);
  });
});

describe('seat blend', () => {
  it('slides in over SIT_SECONDS, out again, and snaps under reduced motion', () => {
    expect(stepSeatBlend(0, true, SIT_SECONDS / 2, false)).toBeCloseTo(0.5);
    expect(stepSeatBlend(0.9, true, SIT_SECONDS, false)).toBe(1);
    expect(stepSeatBlend(0.2, false, SIT_SECONDS, false)).toBe(0);
    expect(stepSeatBlend(0, true, 0.01, true)).toBe(1);
    expect(stepSeatBlend(1, false, 0.01, true)).toBe(0);
    expect(easeSeat(0)).toBe(0);
    expect(easeSeat(1)).toBe(1);
    expect(easeSeat(0.5)).toBeCloseTo(0.5);
    expect(easeSeat(2)).toBe(1);
  });
});

describe('existing workstation chairs', () => {
  it.each(WORKSTATIONS.map((station, index) => ({ ...station, index })))('centres on $id, respecting flip $flip', ({ center: [x, z], flip, index }) => {
    const seat = seatAtApproach(...workstationApproach(index))!;
    expect(seat).toBe(WORKSTATION_SEATS[index]);
    expect(seat.x).toBeCloseTo(x + flip * CHAIR_FOOTPRINT.x);
    expect(seat.z).toBeCloseTo(z + flip * CHAIR_FOOTPRINT.z);
    expect(Math.cos(seat.heading)).toBeCloseTo(-flip);
    expect(Math.sin(seat.heading)).toBeCloseTo(0);
    const cushion = workstationPieces([x, z], flip, PALETTE.navy).find(piece =>
      piece.size[0] === CHAIR_FOOTPRINT.width && piece.at[2] === seat.z)!;
    expect(cushion.at[0]).toBeCloseTo(seat.x);
    expect(cushion.at[1] + cushion.size[1] / 2).toBeCloseTo(CHAIR_SEAT_TOP);
  });

  it('rests both avatars on the existing cushion, with tags above their heads', () => {
    expect(BEAR.hip + BEAR_SEAT_LIFT - BEAR.leg.part.size[2] / 2).toBeCloseTo(CHAIR_SEAT_TOP);
    expect(0.365 + SIT_LIFT_M).toBeCloseTo(CHAIR_SEAT_TOP);
    // Existing card (1.9) and desk/name plate (1.95) projection heights remain clear.
    expect(BEAR_HEIGHT + BEAR_SEAT_LIFT).toBeLessThan(1.9);
    expect(seatAtApproach(100, 100)).toBeNull();
  });
});

describe('seatPieces', () => {
  it.each(['collections', 'payables', 'vendor_onboarding', 'dana'] as const)('adds only a keyboard at %s, no second seat', room => {
    const pieces = seatPieces(room);
    const seat = deskSeat(room)!;
    expect(pieces).toHaveLength(2);
    for (const piece of pieces) expect(palette.has(piece.color)).toBe(true);
    const keyboard = pieces[0]!;
    expect(keyboard.at[0]).toBeCloseTo(seat.x);
    expect(keyboard.at[1] - keyboard.size[1] / 2).toBeCloseTo(0.91);
    expect(Math.abs(angleDelta(keyboard.rotation![1], seat.heading - Math.PI))).toBeLessThan(1e-9);
  });
});
