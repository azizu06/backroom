'use client';

import { useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { CylinderGeometry, MeshLambertMaterial, MeshStandardMaterial, SphereGeometry, type Group } from 'three';
import { ATRIUM_PIECES, ATRIUM_ROOF, ATRIUM_SKYLIGHTS } from '../../../lib/office/wing';
import { ROLES } from '../../../lib/office/palette';
import { StaticInstances, UNIT_BOX } from './StaticGeometry';
import { usePrecompile } from './usePrecompile';

const MATERIAL = new MeshLambertMaterial();
const ROOF_MATERIAL = new MeshLambertMaterial({ emissive: ROLES.ceiling, emissiveIntensity: 0.35 });
const GLASS = new MeshStandardMaterial({ transparent: true, opacity: 0.3, roughness: 0.1, depthWrite: false });
const CYLINDER = new CylinderGeometry(0.5, 0.5, 1, 10);
const CROWN = new SphereGeometry(0.5, 10, 6);
const BOXES = ATRIUM_PIECES.filter(piece => piece.shape === 'box');
const CYLINDERS = ATRIUM_PIECES.filter(piece => piece.shape === 'cylinder');
const CROWNS = ATRIUM_PIECES.filter(piece => piece.shape === 'sphere');

/** Three furniture batches and two roof batches, without animation or extra lights. */
export function Atrium() {
  const overview = useThree(state => (state.camera as { isOrthographicCamera?: boolean }).isOrthographicCamera === true);
  const roof = useRef<Group>(null);
  usePrecompile(roof);
  return <group name='atrium'>
    <StaticInstances pieces={BOXES} geometry={UNIT_BOX} material={MATERIAL} castShadow={false} />
    <StaticInstances pieces={CYLINDERS} geometry={CYLINDER} material={MATERIAL} castShadow={false} />
    <StaticInstances pieces={CROWNS} geometry={CROWN} material={MATERIAL} castShadow={false} />
    <group name='atrium:roof' visible={!overview} ref={roof}>
      <StaticInstances pieces={ATRIUM_ROOF} geometry={UNIT_BOX} material={ROOF_MATERIAL} castShadow={false} receiveShadow={false} />
      <StaticInstances pieces={ATRIUM_SKYLIGHTS} geometry={UNIT_BOX} material={GLASS} castShadow={false} receiveShadow={false} />
    </group>
  </group>;
}
