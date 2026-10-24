import { describe, expect, it } from 'vitest';
import { ROOM_ENTRY_MS, roomAt } from './room-entry';
import { OFFICE_ANCHORS, type AnchorId } from './state';

const rooms = Object.keys(OFFICE_ANCHORS) as AnchorId[];

describe('room entry', () => {
  it.each(rooms)('uses the shared centre of %s', room => {
    expect(roomAt(OFFICE_ANCHORS[room].center, null, rooms)).toBe(room);
  });

  it('enters strictly inside 2.2 m and leaves strictly beyond 2.8 m', () => {
    expect(roomAt([2.2, -3], null, ['payables'])).toBeNull();
    expect(roomAt([2.199, -3], null, ['payables'])).toBe('payables');
    expect(roomAt([2.8, -3], 'payables', ['payables'])).toBe('payables');
    expect(roomAt([2.801, -3], 'payables', ['payables'])).toBeNull();
  });

  it('does not flicker when walking along an entry boundary', () => {
    let current = roomAt([2.1, -3], null, ['payables']);
    for (const x of [2.21, 2.19, 2.4, 2.2, 2.79, 2.19]) {
      current = roomAt([x, -3], current, ['payables']);
      expect(current).toBe('payables');
    }
    current = roomAt([2.81, -3], current, ['payables']);
    for (const x of [2.7, 2.3, 2.21, 2.2]) {
      current = roomAt([x, -3], current, ['payables']);
      expect(current).toBeNull();
    }
    expect(roomAt([2.1, -3], current, ['payables'])).toBe('payables');
  });

  it('keeps the current room in the hysteresis band, then switches directly to a neighbour', () => {
    expect(roomAt([-2.4, -3], 'collections', rooms)).toBe('collections');
    expect(roomAt([-2.1, -3], 'collections', rooms)).toBe('payables');
    expect(roomAt([-2.1, -3], 'payables', rooms)).toBe('payables');
  });

  it('detects exits to the aisle and ignores hidden or removed rooms', () => {
    expect(roomAt([0, 0.3], 'payables', rooms)).toBeNull();
    expect(roomAt([0, -3], null, ['collections'])).toBeNull();
    expect(roomAt([0, -3], 'payables', ['collections'])).toBeNull();
    expect(roomAt([0, -3], null, [])).toBeNull();
    expect(roomAt([NaN, 0], 'lobby', rooms)).toBeNull();
    expect(ROOM_ENTRY_MS).toBe(1600);
  });
});
