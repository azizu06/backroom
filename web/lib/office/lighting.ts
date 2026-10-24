/**
 * Static lighting and material numbers for the 3D office (scene.tsx). Pure data, no three imports,
 * so it is testable in node and safe to import anywhere. Nothing here is animated.
 * Colours come from the cozy pastel roles in ./palette; only intensities and geometry live here.
 */
import { ROLES } from "./palette";

export type Vec3 = [number, number, number];

export interface DirectionalLightConfig {
  color: string;
  intensity: number;
  position: Vec3;
  castShadow: boolean;
}

export interface OfficeLighting {
  /** Warm butter key light; the only shadow caster. */
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

/** Top of the tallest floor pad in scene.tsx; the contact-shadow plane must sit above it. */
export const FLOOR_PAD_TOP = 0.045;
/** Highest underside the contact-shadow pass must skip (room pads and the aisle strip). */
export const FLOOR_PAD_BOTTOM = 0.005;

export const OFFICE_LIGHTING: OfficeLighting = {
  key: {
    color: ROLES.lampLight,
    intensity: 2.2,
    position: [6, 12, 6],
    castShadow: true,
    // near/far bound the light's ~15-unit throw, so the bias is ~0.01 world units, not ~0.2 at three's 0.5..500 default.
    shadow: { mapSize: 1024, bias: -0.0004, near: 1, far: 30, left: -12, right: 12, top: 10, bottom: -10 },
  },
  fill: { color: ROLES.fillLight, intensity: 0.45, position: [-8, 7, 8], castShadow: false },
  hemisphere: { skyColor: ROLES.ceiling, groundColor: ROLES.shadow, intensity: 1.5 },
  // Room pads reach y=0.045 (FLOOR_PAD_TOP), so the shadow plane sits just above them. near=-0.04 lets the upward
  // depth pass also see faces from y=0.01 (avatar feet) while still skipping pad undersides (y<=0.005).
  contactShadows: { position: [0, 0.05, 0], near: -0.04, scale: [16, 11], resolution: 512, blur: 2.5, opacity: 0.35, far: 2.5, color: ROLES.shadow },
  base: { roughness: 0.9 },
  screen: { roughness: 0.2, metalness: 0.1, emissiveIntensity: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.15 },
  vault: { color: ROLES.frame, roughness: 0.45, metalness: 0.3 },
};

export const OFFICE_DIRECTIONAL_LIGHTS: readonly DirectionalLightConfig[] = [OFFICE_LIGHTING.key, OFFICE_LIGHTING.fill];
