// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FLOOR_PAD_BOTTOM, FLOOR_PAD_TOP, MAX_OFFICE_LIGHTS, OFFICE_DIRECTIONAL_LIGHTS, OFFICE_LAMPS, OFFICE_LIGHTING, officeLightRig, officeLowPower } from './lighting';
import { ROLES } from './palette';
import { BUILDING } from './layout';

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

  it('takes every colour from the cozy palette roles: butter key, aqua fill, cream/slate bounce, navy vault', () => {
    expect(OFFICE_LIGHTING.key.color).toBe(ROLES.lampLight);
    expect(OFFICE_LIGHTING.fill.color).toBe(ROLES.fillLight);
    expect(OFFICE_LIGHTING.hemisphere).toMatchObject({ skyColor: ROLES.ceiling, groundColor: ROLES.shadow });
    expect(OFFICE_LIGHTING.contactShadows.color).toBe(ROLES.shadow);
    expect(OFFICE_LIGHTING.vault.color).toBe(ROLES.frame);
  });

  it('keeps the aqua fill at low strength so the warm key still reads', () => {
    expect(OFFICE_LIGHTING.fill.intensity).toBeLessThanOrEqual(OFFICE_LIGHTING.key.intensity * 0.25);
    expect(OFFICE_LIGHTING.fill.intensity).toBeGreaterThan(0);
  });

  it('tints shadows slate, never pure black, and keeps them soft on the pastel floor', () => {
    const shadow = rgb(OFFICE_LIGHTING.contactShadows.color);
    expect(Math.min(shadow.r, shadow.g, shadow.b)).toBeGreaterThan(64);
    expect(shadow.b).toBeGreaterThan(shadow.r);
    expect(OFFICE_LIGHTING.contactShadows.opacity).toBeLessThanOrEqual(0.4);
    const ground = rgb(OFFICE_LIGHTING.hemisphere.groundColor);
    expect(Math.min(ground.r, ground.g, ground.b)).toBeGreaterThan(64);
  });

  it('keeps total light low enough that cream walls do not clip to white', () => {
    const { key, fill, hemisphere } = OFFICE_LIGHTING;
    // Irradiance on an upward face in three's physical units (directional / pi), as a multiple of albedo.
    expect((key.intensity + fill.intensity) / Math.PI + hemisphere.intensity / Math.PI).toBeLessThan(1.4);
  });

  it('configures exactly one shadow caster, the key light', () => {
    const casters = OFFICE_DIRECTIONAL_LIGHTS.filter(light => light.castShadow);
    expect(casters).toEqual([OFFICE_LIGHTING.key]);
  });

  it('keeps shadow buffers small', () => {
    expect(OFFICE_LIGHTING.key.shadow.mapSize).toBeLessThanOrEqual(1024);
    expect(OFFICE_LIGHTING.contactShadows.resolution).toBeLessThanOrEqual(512);
  });

  it('caps the complete rig, sharing two non-shadow-casting lamp pools across six emissive lamps', () => {
    const rig = officeLightRig();
    const allLights = [rig.key, rig.fill, rig.hemisphere, ...rig.pointLights];
    expect(allLights.length).toBeLessThanOrEqual(MAX_OFFICE_LIGHTS);
    expect(MAX_OFFICE_LIGHTS).toBeLessThanOrEqual(6);
    expect(OFFICE_LAMPS).toHaveLength(6);
    expect(rig.pointLights).toHaveLength(2);
    for (const light of rig.pointLights) {
      expect(light.castShadow).toBe(false);
      expect(light.color).toBe(ROLES.lampLight);
      expect(light.decay).toBe(2);
      expect(light.distance).toBeGreaterThan(0);
      expect(light.distance).toBeLessThanOrEqual(5);
      expect(OFFICE_LAMPS.some(lamp => lamp.floor && lamp.room === light.room)).toBe(true);
    }
    expect(rig.shadows).toBe('soft');
  });

  it('drops every point light and both shadow passes in low-power while preserving the room colours and exposure', () => {
    const normal = officeLightRig();
    const saving = officeLightRig(true);
    expect(saving.pointLights).toEqual([]);
    expect(saving.key.castShadow).toBe(false);
    expect(saving.fill.castShadow).toBe(false);
    expect(saving.contactShadows).toBeNull();
    expect(saving.shadows).toBe(false);
    expect(saving.hemisphere).toEqual(normal.hemisphere);
    expect(saving.key.color).toBe(normal.key.color);
    expect(saving.fill.color).toBe(normal.fill.color);
    expect(saving.exposure).toBe(normal.exposure);
    // Switching modes must not mutate the normal rig.
    expect(officeLightRig()).toEqual(normal);
    expect(normal.key.castShadow).toBe(true);
  });

  it('honours explicit low-power, reduced-data and browser data-saver without an override disabling saving', () => {
    expect(officeLowPower('')).toBe(false);
    expect(officeLowPower('?lowPower=0')).toBe(false);
    expect(officeLowPower('?perf=1')).toBe(false);
    expect(officeLowPower('?lowPower=1')).toBe(true);
    expect(officeLowPower('', true)).toBe(true);
    expect(officeLowPower('', false, true)).toBe(true);
    expect(officeLowPower('?lowPower=0', true, true)).toBe(true);
  });

  it('places the contact-shadow plane above the floor pads and keeps pad undersides out of its depth pass', () => {
    const { position, near, scale } = OFFICE_LIGHTING.contactShadows;
    expect(position[1]).toBeGreaterThan(FLOOR_PAD_TOP);
    expect(position[1] + near).toBeGreaterThan(FLOOR_PAD_BOTTOM);
    // Covers the expanded building floor, centred on its footprint, with a small margin.
    expect(position[0]).toBe((BUILDING.minX + BUILDING.maxX) / 2);
    expect(scale[0]).toBeGreaterThanOrEqual(BUILDING.maxX - BUILDING.minX);
    expect(scale[1]).toBeGreaterThanOrEqual(BUILDING.maxZ - BUILDING.minZ);
  });

  it('bounds the key shadow camera so the depth bias stays small in world units', () => {
    const { near, far, bias } = OFFICE_LIGHTING.key.shadow;
    const throwDistance = Math.hypot(...OFFICE_LIGHTING.key.position);
    expect(near).toBeLessThan(throwDistance - 8);
    expect(far).toBeGreaterThan(throwDistance + 8);
    expect(Math.abs(bias) * (far - near)).toBeLessThan(0.02);
  });

  it('makes screens glossier than the rough base material', () => {
    expect(OFFICE_LIGHTING.screen.roughness).toBeLessThan(0.5);
    expect(OFFICE_LIGHTING.screen.roughness).toBeLessThan(OFFICE_LIGHTING.base.roughness);
    expect(OFFICE_LIGHTING.screen.emissiveIntensity).toBeGreaterThanOrEqual(0.15);
    expect(OFFICE_LIGHTING.screen.emissiveIntensity).toBeLessThanOrEqual(0.25);
  });
});
