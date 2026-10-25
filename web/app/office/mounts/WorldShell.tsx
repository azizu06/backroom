'use client';

import { useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { usePrecompile } from './usePrecompile';
import { MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial } from 'three';
import type { FurniturePiece } from '../../../lib/office/furniture';
import { BUILDING, SPACES, SPACE_IDS, WALL_HEIGHT, wallPieces, windowPieces } from '../../../lib/office/layout';
import { OFFICE_LIGHTING } from '../../../lib/office/lighting';
import { OUTDOOR, ROLES } from '../../../lib/office/palette';
import { StaticBoxes, StaticInstances, UNIT_BOX } from './StaticGeometry';

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
const CEILING: FurniturePiece[] = [{ at: [(BUILDING.minX + BUILDING.maxX) / 2, WALL_HEIGHT + SLAB / 2, (BUILDING.minZ + BUILDING.maxZ) / 2],
  size: [BUILDING.maxX - BUILDING.minX + 0.2, SLAB, BUILDING.maxZ - BUILDING.minZ + 0.2], color: ROLES.ceiling }];
/** Two light panels per room, one every 3 m along the corridor. */
const PANELS: FurniturePiece[] = SPACE_IDS.flatMap(id => {
  const { rect, kind } = SPACES[id];
  const cx = (rect.minX + rect.maxX) / 2, cz = (rect.minZ + rect.maxZ) / 2;
  const spots: [number, number][] = kind === 'corridor'
    ? Array.from({ length: Math.floor((rect.maxX - rect.minX) / 3) }, (_, i) => [rect.minX + 1.5 + i * 3, cz])
    : rect.maxX - rect.minX < 4 ? [[cx, cz]] : [[cx - 1.4, cz], [cx + 1.4, cz]];
  return spots.map(([x, z]): FurniturePiece => ({ at: [x, WALL_HEIGHT - 0.02, z], size: kind === 'corridor' ? [0.6, 0.03, 1.1] : [1.1, 0.03, 0.6], color: OUTDOOR.ceilingPanel }));
});

/**
 * The building shell. First person (perspective camera) gets full-height walls, framed windows with glass,
 * a ceiling and its light panels; the overview (orthographic orbit camera) gets cut-away walls and no
 * ceiling so the floor plan stays readable. Static batches only: four or five draws, no per-frame work.
 * Full walls neither cast nor receive shadows: the sun keeps lighting the rooms as it does in the overview, and
 * the wall pixels that fill a first-person frame skip the shadow-map lookups.
 */
export function WorldShell() {
  const overview = useThree(state => (state.camera as { isOrthographicCamera?: boolean }).isOrthographicCamera === true);
  const full = useRef<Group>(null);
  usePrecompile(full);
  return <group name='world-shell'>
    <group ref={full} visible={!overview} name='world-shell:full'>
      <StaticBoxes pieces={FULL_SHELL} material={FULL_WALL_MATERIAL} castShadow={false} receiveShadow={false} />
      <StaticInstances pieces={GLASS} geometry={UNIT_BOX} material={GLASS_MATERIAL} castShadow={false} receiveShadow={false} />
      <StaticInstances pieces={CEILING} geometry={UNIT_BOX} material={CEILING_MATERIAL} castShadow={false} receiveShadow={false} />
      <StaticInstances pieces={PANELS} geometry={UNIT_BOX} material={PANEL_MATERIAL} castShadow={false} receiveShadow={false} />
    </group>
    <group visible={overview} name='world-shell:overview'>
      <StaticBoxes pieces={OVERVIEW_WALLS} material={WALL_MATERIAL} />
    </group>
  </group>;
}
