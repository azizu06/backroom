import { FLOOR } from './play';
import { describe, expect, it } from 'vitest';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type OfficeSnapshot } from './state';
import { headingRotation, mapTransform, minimapItems, worldToMap } from './minimap';

describe('play minimap geometry', () => {
  it('fits both floor corners with equal world scale and padding', () => {
    const transform = mapTransform(200, 10);
    const a = worldToMap([FLOOR.minX, FLOOR.minZ], transform);
    const b = worldToMap([FLOOR.maxX, FLOOR.maxZ], transform);
    expect(a.x).toBeGreaterThanOrEqual(10);
    expect(a.y).toBeGreaterThanOrEqual(10);
    expect(b.x).toBeLessThanOrEqual(190);
    expect(b.y).toBeLessThanOrEqual(190);
    expect(b.x - a.x).toBeCloseTo(b.y - a.y);
    expect(a.x).toBeCloseTo(10);
    expect(b.x).toBeCloseTo(190);
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
