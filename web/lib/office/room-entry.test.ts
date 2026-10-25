import { describe, expect, it } from 'vitest';
import { ROOM_ENTER_RADIUS, ROOM_ENTRY_MS, ROOM_LEAVE_RADIUS, roomAt } from './room-entry';
import { CORRIDOR_Z } from './layout';
import { OFFICE_ANCHORS, type AnchorId } from './state';

const rooms = Object.keys(OFFICE_ANCHORS) as AnchorId[];

describe('room entry', () => {
  it.each(rooms)('uses the shared centre of %s', room => {
    expect(roomAt(OFFICE_ANCHORS[room].center, null, rooms)).toBe(room);
  });

  const [px, pz] = OFFICE_ANCHORS.payables.center;
  const E = ROOM_ENTER_RADIUS, L = ROOM_LEAVE_RADIUS;
  const east = (d: number): [number, number] => [px + d, pz];
  it('enters strictly inside the enter radius and leaves strictly beyond the leave radius', () => {
    expect(roomAt(east(E), null, ['payables'])).toBeNull();
    expect(roomAt(east(E - 0.001), null, ['payables'])).toBe('payables');
    expect(roomAt(east(L - 0.001), 'payables', ['payables'])).toBe('payables');
    expect(roomAt(east(L + 0.001), 'payables', ['payables'])).toBeNull();
  });

  it('does not flicker when walking along an entry boundary', () => {
    let current = roomAt(east(E - 0.1), null, ['payables']);
    for (const d of [E + 0.01, E - 0.01, E + 0.2, E, L - 0.01, E - 0.01]) {
      current = roomAt(east(d), current, ['payables']);
      expect(current).toBe('payables');
    }
    current = roomAt(east(L + 0.01), current, ['payables']);
    for (const d of [L - 0.1, E + 0.1, E + 0.01, E]) {
      current = roomAt(east(d), current, ['payables']);
      expect(current).toBeNull();
    }
    expect(roomAt(east(E - 0.1), current, ['payables'])).toBe('payables');
  });

  it('keeps the current room in the hysteresis band, then switches directly to a neighbour', () => {
    const [cx, cz] = OFFICE_ANCHORS.collections.center;
    // Inside Payables' enter radius but still within Collections' leave radius.
    expect(roomAt([cx + L - 0.2, cz], 'collections', rooms)).toBe('collections');
    expect(roomAt([cx + L + 0.1, cz], 'collections', rooms)).toBeNull();
    expect(roomAt([px - E + 0.1, pz], 'collections', rooms)).toBe('payables');
  });

  it('detects exits to the corridor and ignores hidden or removed rooms', () => {
    expect(roomAt([px, pz + L + 0.1], 'payables', ['payables'])).toBeNull();
    expect(roomAt([px, pz], null, ['collections'])).toBeNull();
    expect(roomAt([px, pz], 'payables', ['collections'])).toBeNull();
    expect(roomAt([px, pz], null, [])).toBeNull();
    expect(roomAt([NaN, 0], 'lobby', rooms)).toBeNull();
    expect(ROOM_ENTRY_MS).toBe(1600);
  });
});
