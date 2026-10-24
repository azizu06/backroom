'use client';

import { useMemo } from 'react';
import { MeshPhysicalMaterial } from 'three';
import { visibleRooms } from '../../../lib/office/state';
import { deskPieces, deskScreenPiece } from '../../../lib/office/furniture';
import { OFFICE_LIGHTING } from '../../../lib/office/lighting';
import { DESKS } from '../../../lib/office/targets/desk';
import { StaticBoxes, StaticInstances, UNIT_BOX } from './StaticGeometry';
import type { SceneMountProps } from './types';
import { ROLES } from '../../../lib/office/palette';

const SCREEN_MATERIAL = new MeshPhysicalMaterial({ color: ROLES.wall, emissive: ROLES.wall, ...OFFICE_LIGHTING.screen });
// three applies instance colour to the diffuse channel; the original screens also tinted their glow.
SCREEN_MATERIAL.onBeforeCompile = shader => {
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    #ifdef USE_COLOR
      totalEmissiveRadiance *= vColor.rgb;
    #endif`);
};
SCREEN_MATERIAL.customProgramCacheKey = () => 'office-instance-screen-glow-v1';

/** Agent and Dana desks: baked static boxes and one glossy face batch, with unchanged footprints. */
export function Desks({ snapshot }: SceneMountProps) {
  const roomsKey = DESKS.filter(room => visibleRooms(snapshot).includes(room)).join(',');
  const { boxes, screens } = useMemo(() => {
    const rooms = DESKS.filter(room => roomsKey.split(',').includes(room));
    return { boxes: rooms.flatMap(deskPieces), screens: rooms.map(deskScreenPiece) };
  }, [roomsKey]);
  if (!boxes.length) return null;
  return <>
    <StaticBoxes pieces={boxes} />
    <StaticInstances pieces={screens} geometry={UNIT_BOX} material={SCREEN_MATERIAL} castShadow={false} />
  </>;
}
