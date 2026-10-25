import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloorPlan } from '../../app/office/FloorPlan';
import { placePlanLabel, planRectsOverlap, type PlanRect } from './plan-labels';
import { BUILDING, POD_BOUNDS, WORKSTATIONS, fixtureBounds } from './layout';
import { DESK_SIZE } from './metrics';
import { MotionRegistry } from './motion';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type OfficeAgent } from './state';

afterEach(() => vi.unstubAllGlobals());

describe('plan label placement', () => {
  it.each([320, 390, 680])('keeps labels outside every desk and other label on a %i px board', size => {
    const pixels = (r: typeof BUILDING): PlanRect => ({ x: (r.minX + 12) / 24 * size, y: (r.minZ + 12) / 24 * size,
      width: (r.maxX - r.minX) / 24 * size, height: (r.maxZ - r.minZ) / 24 * size });
    const obstacles = WORKSTATIONS.map(({ center: [x, z] }) => pixels(fixtureBounds({ x, z, ...DESK_SIZE })));
    for (const pod of POD_BOUNDS) {
      const label = placePlanLabel(pixels(pod), { width: 100, height: 22 }, { x: 0, y: 0, width: size, height: size }, obstacles);
      expect(label).not.toBeNull();
      expect(obstacles.some(rect => planRectsOverlap(rect, label!))).toBe(false);
      expect(label!.x).toBeGreaterThanOrEqual(0);
      expect(label!.y).toBeGreaterThanOrEqual(0);
      expect(label!.x + label!.width).toBeLessThanOrEqual(size);
      expect(label!.y + label!.height).toBeLessThanOrEqual(size);
      obstacles.push(label!);
    }
  });
  it('moves away from a blocked edge and reports when no space remains', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const anchor = { x: 0, y: 0, width: 30, height: 30 };
    const label = placePlanLabel(anchor, { width: 40, height: 20 }, bounds, []);
    expect(label).not.toBeNull();
    expect(planRectsOverlap(label!, anchor)).toBe(false);
    expect(placePlanLabel(anchor, { width: 40, height: 20 }, bounds, [bounds])).toBeNull();
    expect(placePlanLabel(anchor, { width: 101, height: 20 }, bounds, [])).toBeNull();
  });
});

it('draws exactly the snapshot roster, even with stale registry entries, and uses live motion positions', () => {
  vi.stubGlobal('React', React);
  const alex: OfficeAgent = { id: 'alex', name: 'Alex', seatId: 'collections', targetAnchor: 'collections', pos: [0, 0], state: 'Working' };
  const dana: OfficeAgent = { ...alex, id: 'human', name: 'Dana', targetAnchor: 'dana', pos: OFFICE_ANCHORS.dana.position, state: 'Reviewing' };
  const motions = new MotionRegistry();
  motions.get({ ...alex, id: 'removed' });
  motions.get(alex).seat([6, -6]);
  for (const agents of [[], [alex], [alex, dana], [dana]]) {
    const html = renderToStaticMarkup(React.createElement(FloorPlan, { snapshot: { ...INITIAL_OFFICE, agents }, motions, select: () => {} }));
    expect([...html.matchAll(/data-agent="([^"]+)"/g)].map(match => match[1])).toEqual(agents.map(agent => agent.id));
    expect(html.includes('data-human="true"')).toBe(agents.includes(dana));
    expect(html.match(/class="plan-desk"/g)).toHaveLength(WORKSTATIONS.length);
    if (agents.includes(alex)) expect(html).toContain('left:75%;top:25%');
  }
});
