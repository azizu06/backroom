// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { legSwing } from './a11y';
import {
  BEAR, BEAR_CARRY_FRONT, BEAR_FALLBACK_ACCENT, BEAR_HALF_WIDTH, BEAR_HEIGHT, CAL_BLUE, CAL_GOLD,
  armSwing, bearIdle, bearPalette, bearPhase, contrast, luminance, pawPosition,
} from './bear';
import { FLOOR_AGENTS, HANDOFF_AGENTS } from './handoffs';
import { DENY_FALLBACK_COLOR } from './props/treasuryDeny';
import { OFFICE_ANCHORS } from './state';
import { AGENT_RADIUS } from './targets/agent';

const ROOM_FLOOR = '#626e5b';
const roles: [string, string][] = [
  ...(['collections', 'payables', 'vendor_onboarding', 'lobby', 'treasury'] as const).map(id => [`seat:${id}`, OFFICE_ANCHORS[id].color] as [string, string]),
  ...FLOOR_AGENTS.map(id => [`handoff:${id}`, HANDOFF_AGENTS[id].color] as [string, string]),
  ['fallback', BEAR_FALLBACK_ACCENT], ['deny-fallback', DENY_FALLBACK_COLOR],
];

describe('bear palette', () => {
  it('is deterministic hex for every role accent', () => {
    for (const [, accent] of roles) {
      const palette = bearPalette(accent);
      expect(palette).toEqual(bearPalette(accent.toUpperCase()));
      for (const color of Object.values(palette)) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(bearPalette('#a9bc8f')).toEqual({ fur: '#43532d', muzzle: '#d5d1a8', nose: '#1d1a17', scarf: CAL_GOLD, badge: CAL_BLUE });
  });

  it('keeps fur a darker tone of the accent', () => {
    for (const [, accent] of roles) expect(luminance(bearPalette(accent).fur)).toBeLessThan(luminance(accent));
  });

  it.each(roles)('reads clearly for %s', (_, accent) => {
    const { fur, muzzle, nose, scarf, badge } = bearPalette(accent);
    expect(contrast(fur, ROOM_FLOOR)).toBeGreaterThanOrEqual(1.5);
    expect(contrast(fur, accent)).toBeGreaterThanOrEqual(2.5);
    expect(contrast(muzzle, fur)).toBeGreaterThanOrEqual(3);
    expect(contrast(nose, muzzle)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(scarf, fur)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(CAL_GOLD, badge)).toBeGreaterThanOrEqual(4.5);
  });

  it('falls back for colours it cannot parse', () => {
    expect(bearPalette('teal')).toEqual(bearPalette(BEAR_FALLBACK_ACCENT));
    expect(bearPalette('#abc').fur).toBe(bearPalette('#aabbcc').fur);
  });

  it('computes WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#777777')).toBe(1);
  });
});

describe('bear proportions', () => {
  it('stands about as tall and wide as the old avatars so tags and Play targets line up', () => {
    expect(BEAR_HEIGHT).toBeGreaterThan(1.45);
    expect(BEAR_HEIGHT).toBeLessThan(1.65);
    expect(BEAR_HALF_WIDTH).toBeLessThan(AGENT_RADIUS);
    const sole = BEAR.hip + BEAR.foot.at[1] - BEAR.foot.size[1] / 2;
    expect(sole).toBeGreaterThanOrEqual(0);
    expect(sole).toBeLessThan(0.05);
    expect(BEAR.hip + BEAR.leg.part.at[1] - BEAR.leg.part.size[1] / 2).toBeGreaterThanOrEqual(0);
  });

  it('holds front paws under the handoff folder (0.32 m ahead, 0.95 m up)', () => {
    for (const side of [-1, 1] as const) {
      const [x, y, z] = pawPosition(side, BEAR_CARRY_FRONT);
      expect(Math.abs(x)).toBeLessThan(0.25);
      expect(z).toBeCloseTo(0.32, 1);
      expect(y + BEAR.paw.radius).toBeLessThan(0.95);
      expect(y).toBeGreaterThan(0.75);
    }
    const [x, y, z] = pawPosition(1, { pitch: 0, tuck: 0 });
    expect([x, y, Math.abs(z)]).toEqual([BEAR.shoulder.x, BEAR.shoulder.y + BEAR.paw.at[1], 0]);
  });
});

describe('bear motion', () => {
  it('swings arms opposite the same-side leg and only while walking with motion allowed', () => {
    for (const distance of [0.1, 0.4, 1.3]) for (const i of [0, 1]) {
      expect(armSwing(distance, i, true, false)).toBeCloseTo(-legSwing(distance, i, true, false) * 0.8, 10);
      expect(armSwing(distance, i, true, true)).toBe(0);
      expect(armSwing(distance, i, false, false)).toBe(0);
    }
  });

  it('idles subtly, deterministically and not at all under reduced motion', () => {
    const phase = bearPhase('collections_1');
    expect(bearPhase('collections_1')).toBe(phase);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(Math.PI * 2);
    expect(bearPhase('payables_1')).not.toBe(phase);
    expect(bearIdle(12.5, phase, false)).toEqual(bearIdle(12.5, phase, false));
    expect(bearIdle(12.5, phase, true)).toEqual({ breath: 0, tilt: 0, nod: 0 });
    expect(bearIdle(Number.NaN, phase, false)).toEqual({ breath: 0, tilt: 0, nod: 0 });
    for (let t = 0; t < 20; t += 0.37) {
      const idle = bearIdle(t, phase, false);
      expect(Math.abs(idle.breath)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(idle.tilt)).toBeLessThanOrEqual(0.08);
      expect(Math.abs(idle.nod)).toBeLessThanOrEqual(0.04);
    }
  });
});
