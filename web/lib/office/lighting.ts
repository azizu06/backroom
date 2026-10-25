/**
 * Static lighting and material numbers for the 3D office (scene.tsx). Pure data, no three imports,
 * so it is testable in node and safe to import anywhere. Nothing here is animated.
 * Colours come from the cozy pastel roles in ./palette; only intensities and geometry live here.
 */
import { ROLES } from "./palette";
import { OFFICE_ANCHORS, type AnchorId } from "./state";
import { BUILDING, roomPoint } from "./layout";

export type Vec3 = [number, number, number];

export interface DirectionalLightConfig {
  color: string;
  intensity: number;
  position: Vec3;
  castShadow: boolean;
}

export interface OfficeLighting {
  /** Warm butter key light: the sun (Outdoors draws its disc along this direction); the only shadow caster. */
  key: DirectionalLightConfig & {
    shadow: { mapSize: number; bias: number; near: number; far: number; left: number; right: number; top: number; bottom: number };
  };
  /** Cool aqua fill from the opposite side at low strength; no shadow. */
  fill: DirectionalLightConfig;
  /** Soft bounce: cream from above, slate from below, so shaded faces tint slate instead of going black. */
  hemisphere: { skyColor: string; groundColor: string; intensity: number };
  contactShadows: {
    position: Vec3;
    /** Depth-pass near plane, relative to the shadow plane (negative reaches just below it). */
    near: number;
    scale: [number, number];
    resolution: number;
    blur: number;
    opacity: number;
    far: number;
    color: string;
  };
  /** Shared base for every instanced block. */
  base: { roughness: number };
  /** Desk monitor faces: glossier than the base, faint accent glow. */
  screen: { roughness: number; metalness: number; emissiveIntensity: number; clearcoat: number; clearcoatRoughness: number };
  /** Treasury vault door plate: dusty navy so the door reads against cream walls. */
  vault: { color: string; roughness: number; metalness: number };
}

/**
 * Extra layer for moving scene pieces (avatars, doors, carried folders). They also stay on layer 0; the contact
 * shadow redraws only this layer per frame and bakes the rest. Outdoors uses layer 2.
 */
export const CONTACT_DYNAMIC_LAYER = 3;

/** Top of the tallest floor pad in scene.tsx; the contact-shadow plane must sit above it. */
export const FLOOR_PAD_TOP = 0.045;
/** Highest underside the contact-shadow pass must skip (room pads and the aisle strip). */
export const FLOOR_PAD_BOTTOM = 0.005;

export const OFFICE_LIGHTING: OfficeLighting = {
  key: {
    color: ROLES.lampLight,
    intensity: 2.2,
    // A late-afternoon sun low in the south-east (about 27 degrees up), so its disc shows through the windows.
    position: [15, 10, 13],
    castShadow: true,
    // Cover the expanded 36 x 15 building and 7 m atrium, keeping depth bias below 0.02 world units.
    shadow: { mapSize: 1024, bias: -0.0003, near: 1, far: 55, left: -26, right: 26, top: 24, bottom: -24 },
  },
  fill: { color: ROLES.fillLight, intensity: 0.45, position: [-8, 7, 8], castShadow: false },
  hemisphere: { skyColor: ROLES.ceiling, groundColor: ROLES.shadow, intensity: 1.5 },
  // Room pads reach y=0.045 (FLOOR_PAD_TOP), so the shadow plane sits just above them. near=-0.04 lets the upward
  // depth pass also see faces from y=0.01 (avatar feet) while still skipping pad undersides (y<=0.005).
  contactShadows: { position: [(BUILDING.minX + BUILDING.maxX) / 2, 0.05, 0], near: -0.04, scale: [BUILDING.maxX - BUILDING.minX + 0.5, BUILDING.maxZ - BUILDING.minZ + 0.5], resolution: 512, blur: 2.5, opacity: 0.35, far: 2.5, color: ROLES.shadow },
  base: { roughness: 0.9 },
  screen: { roughness: 0.2, metalness: 0.1, emissiveIntensity: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.15 },
  vault: { color: ROLES.frame, roughness: 0.45, metalness: 0.3 },
};

export const OFFICE_DIRECTIONAL_LIGHTS: readonly DirectionalLightConfig[] = [OFFICE_LIGHTING.key, OFFICE_LIGHTING.fill];

/** Includes the hemisphere, both directionals and the shared lamp pools. Never one light per desk. */
export const MAX_OFFICE_LIGHTS = 6;
export const OFFICE_EXPOSURE = 1;
export const LOW_POWER_QUERY = '(prefers-reduced-data: reduce)';

export interface OfficeLamp {
  room: AnchorId;
  base: Vec3;
  height: number;
  floor: boolean;
}

function lampBase(room: 'lobby' | 'treasury', dx: number, dz: number): Vec3 {
  const [x, z] = roomPoint(room, dx, dz);
  return [x, 0.05, z];
}

/** Small desk lamps sit within the existing desk footprints; floor lamps stay out of the aisle. */
export const OFFICE_LAMPS: readonly OfficeLamp[] = [
  ...(['collections', 'payables', 'vendor_onboarding', 'dana'] as const).map(room => {
    const [x, z] = OFFICE_ANCHORS[room].center;
    const flip = room === 'dana' ? -1 : 1;
    return { room, base: [x + flip * 0.9, 0.91, z - flip * 0.3] as Vec3, height: 0.55, floor: false };
  }),
  { room: 'lobby', base: lampBase('lobby', -2.4, 2.9), height: 1.9, floor: true },
  { room: 'treasury', base: lampBase('treasury', 2, 1.1), height: 1.9, floor: true },
];

const LAMP_POOLS = OFFICE_LAMPS.filter(lamp => lamp.floor).map(lamp => ({
  room: lamp.room,
  position: [lamp.base[0], lamp.base[1] + lamp.height - 0.1, lamp.base[2]] as Vec3,
  color: ROLES.lampLight,
  intensity: 1.2,
  distance: 5,
  decay: 2,
  castShadow: false as const,
}));

/** Static in every motion mode: no light animation or frame requests, including reduced motion. */
export function officeLightRig(lowPower = false) {
  return {
    key: { ...OFFICE_LIGHTING.key, castShadow: !lowPower },
    fill: OFFICE_LIGHTING.fill,
    hemisphere: OFFICE_LIGHTING.hemisphere,
    pointLights: lowPower ? [] : LAMP_POOLS,
    contactShadows: lowPower ? null : OFFICE_LIGHTING.contactShadows,
    shadows: lowPower ? false as const : 'soft' as const,
    exposure: OFFICE_EXPOSURE,
  };
}

/** No existing quality switch; honour browser data saving and offer an explicit lighting override. */
export function officeLowPower(search: string, reducedData = false, saveData = false): boolean {
  return new URLSearchParams(search).get('lowPower') === '1' || reducedData || saveData;
}
