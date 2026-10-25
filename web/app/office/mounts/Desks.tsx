'use client';

import { useMemo } from 'react';
import { MeshPhysicalMaterial } from 'three';
import { visibleRooms } from '../../../lib/office/state';
import { deskPieces, deskScreenPiece, workstationPieces, EXTRA_WORKSTATIONS } from '../../../lib/office/furniture';
import { MONITOR_FACE } from '../../../lib/office/props/monitors';
import { OFFICE_LIGHTING } from '../../../lib/office/lighting';
import { DESKS } from '../../../lib/office/targets/desk';
import { StaticBoxes, StaticInstances, UNIT_BOX } from './StaticGeometry';
import type { SceneMountProps } from './types';
import { ROLES } from '../../../lib/office/palette';
import { deskKitReplaces } from '../../../lib/office/deskkit';
import { useDeskKitReady } from './DeskKit';

const SCREEN_MATERIAL = new MeshPhysicalMaterial({ color: ROLES.wall, emissive: ROLES.wall, ...OFFICE_LIGHTING.screen });
// three applies instance colour to the diffuse channel; the original screens also tinted their glow.
SCREEN_MATERIAL.onBeforeCompile = shader => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    #ifdef USE_COLOR
      totalEmissiveRadiance *= vColor.rgb;
    #endif`);
};
SCREEN_MATERIAL.customProgramCacheKey = () => 'office-instance-screen-glow-v1';

/**
 * Twelve shared pod seats: static boxes and one glossy face batch, with matching collision footprints.
 * Under ?art=baked with the desk kit loaded, the kit draws the desk, chair and monitor casing; the live screens stay.
 */
export function Desks({ snapshot }: SceneMountProps) {
  const kit = useDeskKitReady();
  const roomsKey = visibleRooms(snapshot).join(',');
  const { boxes, screens } = useMemo(() => {
    // Pod geometry is permanent, even before the live department rows arrive.
    const rooms = DESKS;
    return { boxes: [...rooms.filter(room => !deskKitReplaces(kit, room) || !roomsKey.split(',').includes(room)).flatMap(deskPieces),
      ...EXTRA_WORKSTATIONS.flatMap(({ center, flip }) => workstationPieces(center, flip, ROLES.partition))],
      screens: [...rooms.map(deskScreenPiece), ...EXTRA_WORKSTATIONS.map(({ center: [x, z], flip }) => ({
        at: [x + flip * MONITOR_FACE.x, MONITOR_FACE.y, z + flip * (MONITOR_FACE.z + 0.05)] as [number, number, number],
        size: [MONITOR_FACE.width, MONITOR_FACE.height, 0.015] as [number, number, number], color: ROLES.screenGlow,
        rotation: [0, flip === -1 ? Math.PI : 0, 0] as [number, number, number],
      }))] };
  }, [roomsKey, kit]);
  if (!screens.length) return null;
  return <>
    {boxes.length > 0 && <StaticBoxes pieces={boxes} />}
    <StaticInstances pieces={screens} geometry={UNIT_BOX} material={SCREEN_MATERIAL} castShadow={false} />
  </>;
}
