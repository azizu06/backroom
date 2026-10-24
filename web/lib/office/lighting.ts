/**
 * Static lighting and material numbers for the 3D office (scene.tsx). Pure data, no three imports,
 * so it is testable in node and safe to import anywhere. Nothing here is animated.
 */
export type Vec3 = [number, number, number];

export interface DirectionalLightConfig {
  color: string;
  intensity: number;
  position: Vec3;
  castShadow: boolean;
}

export interface OfficeLighting {
  /** Warm key light; the only shadow caster. */
  key: DirectionalLightConfig & {
    shadow: { mapSize: number; bias: number; left: number; right: number; top: number; bottom: number };
  };
  /** Cool fill from the opposite side; no shadow. */
  fill: DirectionalLightConfig;
  /** Replaces the old flat ambientLight(1.7): warm sky, cool-green ground. */
  hemisphere: { skyColor: string; groundColor: string; intensity: number };
  contactShadows: {
    position: Vec3;
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
  /** Treasury vault door plate. */
  vault: { color: string; roughness: number; metalness: number };
}

export const OFFICE_LIGHTING: OfficeLighting = {
  key: {
    color: '#ffd6a5',
    intensity: 3,
    position: [6, 12, 6],
    castShadow: true,
    shadow: { mapSize: 1024, bias: -0.0004, left: -12, right: 12, top: 10, bottom: -10 },
  },
  fill: { color: '#a8c4ff', intensity: 1.1, position: [-8, 7, 8], castShadow: false },
  hemisphere: { skyColor: '#fff1de', groundColor: '#9fb3a0', intensity: 1.7 },
  // Floor slab top is y=0; room pads reach y=0.045, so the shadow plane sits just above them.
  contactShadows: { position: [0, 0.05, 0], scale: [16, 11], resolution: 512, blur: 2.5, opacity: 0.42, far: 2.5, color: '#1a1f1a' },
  base: { roughness: 0.9 },
  screen: { roughness: 0.2, metalness: 0.1, emissiveIntensity: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.15 },
  vault: { color: '#718176', roughness: 0.45, metalness: 0.3 },
};

export const OFFICE_DIRECTIONAL_LIGHTS: readonly DirectionalLightConfig[] = [OFFICE_LIGHTING.key, OFFICE_LIGHTING.fill];
