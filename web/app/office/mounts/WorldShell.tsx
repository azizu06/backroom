'use client';

import { useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { usePrecompile } from './usePrecompile';
import { MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial } from 'three';
import type { FurniturePiece } from '../../../lib/office/furniture';
import { BUILDING, WALL_HEIGHT, wallPieces, windowPieces } from '../../../lib/office/layout';
import { OFFICE_LIGHTING } from '../../../lib/office/lighting';
import { OUTDOOR, ROLES } from '../../../lib/office/palette';
import { StaticBoxes, StaticInstances, UNIT_BOX } from './StaticGeometry';
import { useBakedHallReady } from './BakedArt';
import { bakedReplacesHall } from '../../../lib/office/baked-art';

// Shared for the lazy scene's lifetime, like the other static batches. Instance colours (palette tokens) tint white materials.
const WALL_MATERIAL = new MeshStandardMaterial({ vertexColors: true, roughness: OFFICE_LIGHTING.base.roughness });
// Both directional lights come from the south, so north-facing wall faces would read grey; a faint cream glow keeps them warm.
// Lambert: walls and ceiling fill most first-person pixels, so they use the cheaper diffuse model (they are matte anyway).
const FULL_WALL_MATERIAL = new MeshLambertMaterial({ vertexColors: true, emissive: ROLES.wall, emissiveIntensity: 0.22 });
const GLASS_MATERIAL = new MeshStandardMaterial({ transparent: true, opacity: 0.16, roughness: 0.05, metalness: 0.1, depthWrite: false });
// The ceiling's underside faces away from the sky light, so it carries its own soft glow.
const CEILING_MATERIAL = new MeshLambertMaterial({ emissive: ROLES.ceiling, emissiveIntensity: 0.35 });
const PANEL_MATERIAL = new MeshBasicMaterial();

const FULL_WALLS = wallPieces('full');
const OVERVIEW_WALLS = wallPieces('overview');
const { frames: FRAMES, glass: GLASS } = windowPieces();
/** Walls and window frames share one merged draw. */
const FULL_SHELL = [...FULL_WALLS, ...FRAMES];
const SLAB = 0.1;
const CEILING: FurniturePiece[] = [{ at: [0, WALL_HEIGHT + SLAB / 2, 0],
  size: [BUILDING.maxX - BUILDING.minX + 0.16, SLAB, BUILDING.maxZ - BUILDING.minZ + 0.16], color: ROLES.ceiling }];
const PANELS: FurniturePiece[] = [-8, 0, 8].flatMap(x => [-4, 3].map(z => ({
  at: [x, WALL_HEIGHT - 0.02, z], size: [1.1, 0.03, 0.6], color: OUTDOOR.ceilingPanel,
})));

/**
 * The building shell. First person (perspective camera) gets full-height walls, framed windows with glass,
 * a ceiling and its light panels; the overview (orthographic orbit camera) gets cut-away walls and no
 * ceiling so the floor plan stays readable. Static batches only: four or five draws, no per-frame work.
 * Full walls neither cast nor receive shadows: the sun keeps lighting the rooms as it does in the overview, and
 * the wall pixels that fill a first-person frame skip the shadow-map lookups.
 */
export function WorldShell() {
  const hall = useBakedHallReady();
  const overview = useThree(state => (state.camera as { isOrthographicCamera?: boolean }).isOrthographicCamera === true);
  const full = useRef<Group>(null);
  usePrecompile(full);
  return <group name='world-shell'>
    <group ref={full} visible={!overview && !bakedReplacesHall(hall, 'walls')} name='world-shell:full'>
      <StaticBoxes pieces={FULL_SHELL} material={FULL_WALL_MATERIAL} castShadow={false} receiveShadow={false} />
      <StaticInstances pieces={GLASS} geometry={UNIT_BOX} material={GLASS_MATERIAL} castShadow={false} receiveShadow={false} />
      <StaticInstances pieces={CEILING} geometry={UNIT_BOX} material={CEILING_MATERIAL} castShadow={false} receiveShadow={false} />
      <StaticInstances pieces={PANELS} geometry={UNIT_BOX} material={PANEL_MATERIAL} castShadow={false} receiveShadow={false} />
    </group>
    <group visible={overview && !bakedReplacesHall(hall, 'walls')} name='world-shell:overview'>
      <StaticBoxes pieces={OVERVIEW_WALLS} material={WALL_MATERIAL} />
    </group>
  </group>;
}
