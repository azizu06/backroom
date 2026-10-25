import { describe, expect, it } from 'vitest';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type OfficeSnapshot } from './state';
import { headingRotation, mapTransform, minimapItems, worldToMap } from './minimap';
import { TICKET_BOARD_POSITION } from './props/ticketBoard';

describe('play minimap geometry', () => {
  it('marks the always-mounted ticket board at its actual wall position', () => {
    expect(minimapItems(INITIAL_OFFICE, []).filter(item => item.kind === 'board')).toEqual([
      { kind: 'board', name: 'Tickets', position: TICKET_BOARD_POSITION },
    ]);
    const point = worldToMap(TICKET_BOARD_POSITION, mapTransform(200, 10));
    expect(point.x).toBeGreaterThanOrEqual(10);
    expect(point.y).toBeGreaterThanOrEqual(10);
    expect(point.x).toBeLessThanOrEqual(190);
    expect(point.y).toBeLessThanOrEqual(190);
  });
  it('fits both floor corners with equal world scale and padding', () => {
    const transform = mapTransform(200, 10);
    const a = worldToMap([-8, -5.5], transform);
    const b = worldToMap([8, 5.5], transform);
    expect(a.x).toBeGreaterThanOrEqual(10);
    expect(a.y).toBeGreaterThanOrEqual(10);
    expect(b.x).toBeLessThanOrEqual(190);
    expect(b.y).toBeLessThanOrEqual(190);
    expect((b.x - a.x) / 16).toBeCloseTo((b.y - a.y) / 11);
  });
  it('rotates the arrow consistently with the camera forward vector', () => {
    expect(headingRotation(0)).toBeCloseTo(0);
    expect(headingRotation(Math.PI / 2)).toBe(-90);
  });
  it('excludes hidden and unknown rooms', () => {
    const snapshot = { ...INITIAL_OFFICE, rooms: [{ id: 'lobby', rowId: 'lobby' }] } as OfficeSnapshot;
    const items = minimapItems(snapshot, ['lobby', 'missing' as keyof typeof OFFICE_ANCHORS]);
    expect(items.filter(item => item.kind === 'room').map(item => item.name)).toEqual(['Lobby']);
    expect(items.some(item => item.kind === 'door')).toBe(false);
    expect(items.some(item => item.kind === 'kiosk')).toBe(true);
  });
});
