'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, MeshBasicMaterial, Object3D, SphereGeometry,
  type InstancedMesh, type Material } from 'three';
import type { FurniturePiece } from '../../../lib/office/furniture';
import { BIRD_COUNT, CLOUD_COUNT, birdHeading, birdPosition, cloudPosition, daylightBlend,
  outdoorMotionVisible, outdoorSway } from '../../../lib/office/outdoor-motion';
import { subscribeOutdoorTicker } from '../../../lib/office/outdoor-ticker';
import { OUTDOOR } from '../../../lib/office/palette';
import { useReducedMotion } from './shared';

const CLOUD = new SphereGeometry(1, 10, 6);
const CLOUD_MATERIAL = new MeshBasicMaterial({ color: OUTDOOR.cloud, transparent: true, opacity: 0.72, depthWrite: false, fog: false });
const BIRD = new BufferGeometry();
BIRD.setAttribute('position', new Float32BufferAttribute([
  0, 0, 0.4, -1, 0.12, -0.1, -0.3, 0, -0.2,
  0, 0, 0.4, 0.3, 0, -0.2, 1, 0.12, -0.1,
], 3));
const BIRD_MATERIAL = new MeshBasicMaterial({ color: OUTDOOR.bird, side: DoubleSide, fog: false });

export interface WindBatch { pieces: readonly FurniturePiece[]; geometry: BufferGeometry; material: Material }

/** Shared low-rate ticker for every outdoor instance; no frame subscription or vertex uploads. */
export function OutdoorLife({ plants, overview, skyMaterial, sunMaterial, haloMaterial, rain }: {
  plants: readonly WindBatch[]; overview: boolean; skyMaterial: MeshBasicMaterial; sunMaterial: MeshBasicMaterial;
  haloMaterial: MeshBasicMaterial; rain: boolean;
}) {
  const seconds = useRef(0);
  const meshes = useRef<(InstancedMesh | null)[]>([]);
  const clouds = useRef<InstancedMesh>(null), birds = useRef<InstancedMesh>(null);
  const camera = useThree(state => state.camera), invalidate = useThree(state => state.invalidate);
  const reduced = useReducedMotion();
  const [scratch] = useState(() => ({ transform: new Object3D(), color: new Color(),
    skyStart: new Color(OUTDOOR.skyTint), skyEnd: new Color(OUTDOOR.skyTintWarm),
    sunStart: new Color(OUTDOOR.sun), sunEnd: new Color(OUTDOOR.sunWarm), rainSun: new Color(OUTDOOR.rainSun) }));

  useLayoutEffect(() => {
    const { transform, color } = scratch;
    function update(seconds: number) {
      for (let batch = 0; batch < plants.length; batch++) {
        const mesh = meshes.current[batch];
        if (!mesh) continue;
        const pieces = plants[batch]!.pieces;
        for (let i = 0; i < pieces.length; i++) {
          const piece = pieces[i]!;
          const sway = reduced ? 0 : outdoorSway(seconds, piece.at[0] * 0.7 + piece.at[2] * 0.3);
          transform.position.set(piece.at[0], piece.at[1], piece.at[2]);
          transform.rotation.set((piece.rotation?.[0] ?? 0) + sway * 0.6, piece.rotation?.[1] ?? 0, (piece.rotation?.[2] ?? 0) + sway);
          transform.scale.set(piece.size[0], piece.size[1], piece.size[2]);
          transform.updateMatrix();
          mesh.setMatrixAt(i, transform.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
      transform.rotation.set(0, 0, 0);
      if (clouds.current) {
        for (let i = 0; i < CLOUD_COUNT * 3; i++) {
          const cloud = Math.floor(i / 3), puff = i % 3;
          transform.position.set(cloudPosition(seconds, cloud, 'x') + (puff - 1) * 5,
            cloudPosition(seconds, cloud, 'y') + (puff === 1 ? 1 : 0), cloudPosition(seconds, cloud, 'z'));
          transform.scale.set(puff === 1 ? 8 : 6, puff === 1 ? 3 : 2, 4);
          transform.updateMatrix();
          clouds.current.setMatrixAt(i, transform.matrix);
        }
        clouds.current.instanceMatrix.needsUpdate = true;
      }
      if (birds.current) {
        transform.scale.setScalar(0.65);
        for (let i = 0; i < BIRD_COUNT; i++) {
          transform.position.set(birdPosition(seconds, i, 'x'), birdPosition(seconds, i, 'y'), birdPosition(seconds, i, 'z'));
          // Heading follows the ellipse tangent; wings remain in a gentle fixed glide.
          const angle = birdHeading(seconds);
          transform.rotation.set(0, Math.atan2(32 * Math.cos(angle), -24 * Math.sin(angle)), 0.08);
          transform.updateMatrix();
          birds.current.setMatrixAt(i, transform.matrix);
        }
        birds.current.instanceMatrix.needsUpdate = true;
      }
      const daylight = daylightBlend(seconds);
      skyMaterial.color.copy(scratch.skyStart).lerp(scratch.skyEnd, daylight);
      sunMaterial.color.copy(scratch.sunStart).lerp(scratch.sunEnd, daylight);
      if (rain) sunMaterial.color.copy(scratch.rainSun);
      haloMaterial.color.set(rain ? OUTDOOR.rainSunHalo : OUTDOOR.sunHalo);
    }
    for (let batch = 0; batch < plants.length; batch++) {
      const mesh = meshes.current[batch];
      if (!mesh) continue;
      const pieces = plants[batch]!.pieces;
      for (let i = 0; i < pieces.length; i++) mesh.setColorAt(i, color.set(pieces[i]!.color));
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
    const owned = [...meshes.current, clouds.current, birds.current];
    return () => {
      unsubscribe?.();
      for (const mesh of owned) mesh?.dispose();
      skyMaterial.color.copy(scratch.skyStart);
      sunMaterial.color.copy(scratch.sunStart);
    };
  }, [camera, invalidate, overview, plants, reduced, scratch, skyMaterial, sunMaterial, haloMaterial, rain]);

  return <group name='outdoors:life'>
    {plants.map((batch, index) => <instancedMesh key={index} ref={mesh => { meshes.current[index] = mesh; }}
      args={[batch.geometry, batch.material, batch.pieces.length]} frustumCulled={false} dispose={null} />)}
    <instancedMesh ref={clouds} args={[CLOUD, CLOUD_MATERIAL, CLOUD_COUNT * 3]} visible={!overview} frustumCulled={false} dispose={null} />
    <instancedMesh ref={birds} args={[BIRD, BIRD_MATERIAL, BIRD_COUNT]} visible={!overview} frustumCulled={false} dispose={null} />
  </group>;
}
