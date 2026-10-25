'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { BoxGeometry, Color, MeshBasicMaterial, MeshLambertMaterial, Object3D, type InstancedMesh } from 'three';
import { CAR_COUNT, PEOPLE_COUNT, RAIN_COUNT, carPosition, personHeading, personPosition, rainPosition } from '../../../lib/office/outdoor-activity-motion';
import { outdoorMotionVisible } from '../../../lib/office/outdoor-motion';
import { subscribeOutdoorTicker } from '../../../lib/office/outdoor-ticker';
import { OUTDOOR } from '../../../lib/office/palette';
import { mergeBoxes } from './StaticGeometry';
import { useReducedMotion } from './shared';

// Baked low-poly silhouettes: one instanced draw each for people, cars and rain.
const PERSON = mergeBoxes([
  { at: [0, 1.51, 0], size: [0.3, 0.34, 0.3], color: OUTDOOR.sunWarm },
  { at: [0, 1.02, 0], size: [0.46, 0.62, 0.3], color: OUTDOOR.sofa },
  ...[-1, 1].map(side => ({ at: [side * 0.31, 0.99, 0] as [number, number, number], size: [0.14, 0.6, 0.18] as [number, number, number], color: OUTDOOR.sofa })),
  ...[-1, 1].map(side => ({ at: [side * 0.13, 0.35, 0] as [number, number, number], size: [0.18, 0.7, 0.23] as [number, number, number], color: OUTDOOR.bird })),
]);
const CAR = mergeBoxes([
  { at: [0, 0.65, 0], size: [1.65, 0.65, 3.6], color: OUTDOOR.counter },
  { at: [0, 1.17, -0.15], size: [1.35, 0.55, 1.8], color: OUTDOOR.glass },
  ...[-1, 1].flatMap(side => [-1.1, 1.1].map(z => ({ at: [side * 0.8, 0.35, z] as [number, number, number],
    size: [0.25, 0.55, 0.6] as [number, number, number], color: OUTDOOR.screen }))),
]);
const MATERIAL = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
const RAIN = new BoxGeometry(0.025, 0.65, 0.025);
const RAIN_MATERIAL = new MeshBasicMaterial({ color: OUTDOOR.rain, transparent: true, opacity: 0.38, depthWrite: false });
const BATCHES = [
  { geometry: PERSON, material: MATERIAL, count: PEOPLE_COUNT },
  { geometry: CAR, material: MATERIAL, count: CAR_COUNT },
  { geometry: RAIN, material: RAIN_MATERIAL, count: RAIN_COUNT },
];
const TINTS = [OUTDOOR.skyTint, OUTDOOR.sunWarm, OUTDOOR.glass, OUTDOOR.skyTintWarm];

export function OutdoorActivity({ overview, rain }: { overview: boolean; rain: boolean }) {
  const seconds = useRef(0);
  const meshes = useRef<(InstancedMesh | null)[]>([]);
  const camera = useThree(state => state.camera), invalidate = useThree(state => state.invalidate);
  const reduced = useReducedMotion();
  const [scratch] = useState(() => ({ transform: new Object3D(), color: new Color() }));

  useLayoutEffect(() => {
    const { transform, color } = scratch;
    function update(seconds: number) {
      for (let batch = 0; batch < BATCHES.length; batch++) {
        const mesh = meshes.current[batch];
        if (!mesh || (batch === 2 && !rain)) continue;
        for (let i = 0; i < BATCHES[batch]!.count; i++) {
          transform.scale.setScalar(1);
          if (batch === 0) {
            transform.position.set(personPosition(seconds, i, 'x'), personPosition(seconds, i, 'y'), personPosition(seconds, i, 'z'));
            transform.rotation.set(0, personHeading(seconds, i), 0);
          } else if (batch === 1) {
            transform.position.set(carPosition(seconds, i, 'x'), 0.05, carPosition(seconds, i, 'z'));
            transform.rotation.set(0, i === 1 ? -Math.PI / 2 : Math.PI / 2, 0);
          } else {
            transform.position.set(rainPosition(seconds, i, 'x'), rainPosition(seconds, i, 'y'), rainPosition(seconds, i, 'z'));
            transform.rotation.set(0, 0, -0.12);
          }
          transform.updateMatrix();
          mesh.setMatrixAt(i, transform.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    for (let batch = 0; batch < 2; batch++) {
      const mesh = meshes.current[batch];
      if (!mesh) continue;
      for (let i = 0; i < BATCHES[batch]!.count; i++) mesh.setColorAt(i, color.set(TINTS[i % TINTS.length]!));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    update(seconds.current);
    invalidate();
    const unsubscribe = reduced ? undefined : subscribeOutdoorTicker(elapsed => {
      if (!outdoorMotionVisible(overview, camera.position.x, camera.position.z)) return false;
      seconds.current += elapsed;
      update(seconds.current);
      return true;
    }, invalidate);
    const owned = [...meshes.current];
    return () => {
      unsubscribe?.();
      owned.forEach(mesh => mesh?.dispose());
    };
  }, [camera, invalidate, overview, rain, reduced, scratch]);

  return <group name='outdoors:activity'>
    {BATCHES.map((batch, index) => <instancedMesh key={index} ref={mesh => { meshes.current[index] = mesh; }}
      args={[batch.geometry, batch.material, batch.count]} visible={index !== 2 || rain} frustumCulled={false} dispose={null} />)}
  </group>;
}
