// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { OFFICE_DIRECTIONAL_LIGHTS, OFFICE_LIGHTING } from './lighting';

function rgb(hex: string) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not a #rrggbb color: ${hex}`);
  return { r: parseInt(match[1]!, 16), g: parseInt(match[2]!, 16), b: parseInt(match[3]!, 16) };
}

describe('office lighting', () => {
  it('pairs a warm key with a cool, dimmer fill', () => {
    const key = rgb(OFFICE_LIGHTING.key.color);
    const fill = rgb(OFFICE_LIGHTING.fill.color);
    expect(key.r).toBeGreaterThan(key.b);
    expect(fill.b).toBeGreaterThan(fill.r);
    expect(OFFICE_LIGHTING.fill.intensity).toBeLessThan(OFFICE_LIGHTING.key.intensity);
  });

  it('configures exactly one shadow caster, the key light', () => {
    const casters = OFFICE_DIRECTIONAL_LIGHTS.filter(light => light.castShadow);
    expect(casters).toEqual([OFFICE_LIGHTING.key]);
  });

  it('keeps shadow buffers small', () => {
    expect(OFFICE_LIGHTING.key.shadow.mapSize).toBeLessThanOrEqual(1024);
    expect(OFFICE_LIGHTING.contactShadows.resolution).toBeLessThanOrEqual(512);
  });

  it('places contact shadows just above the floor and keeps them soft', () => {
    const { position, opacity, blur, far, scale } = OFFICE_LIGHTING.contactShadows;
    expect(position[1]).toBeGreaterThan(0);
    expect(position[1]).toBeLessThan(0.1);
    expect(scale).toEqual([16, 11]);
    expect(opacity).toBeGreaterThanOrEqual(0.35);
    expect(opacity).toBeLessThanOrEqual(0.5);
    expect(blur).toBeGreaterThanOrEqual(2);
    expect(blur).toBeLessThanOrEqual(3);
    expect(far).toBeGreaterThanOrEqual(2);
    expect(far).toBeLessThanOrEqual(3);
  });

  it('makes screens glossier than the rough base material', () => {
    expect(OFFICE_LIGHTING.screen.roughness).toBeLessThan(0.5);
    expect(OFFICE_LIGHTING.screen.roughness).toBeLessThan(OFFICE_LIGHTING.base.roughness);
    expect(OFFICE_LIGHTING.screen.emissiveIntensity).toBeGreaterThanOrEqual(0.15);
    expect(OFFICE_LIGHTING.screen.emissiveIntensity).toBeLessThanOrEqual(0.25);
  });
});
