'use client';

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3, type Group } from 'three';
import { interactionStore } from '../../../lib/office/interactions';
import { visibleRooms } from '../../../lib/office/state';
import { useSceneTextNode } from '../props/useSceneTextNode';
import type { SceneMountProps } from './types';

/** A single cosmetic folder, rendered either on a surface or in the lower first-person view. */
export function CarryFolder({ snapshot }: SceneMountProps) {
  const { folder } = useSyncExternalStore(interactionStore.subscribe, interactionStore.getSnapshot, interactionStore.getServerSnapshot);
  const held = folder === null;
  const group = useRef<Group>(null);
  const offset = useMemo(() => new Vector3(), []);
  const invalidate = useThree(state => state.invalidate);
  const shown = held || folder.room === null || visibleRooms(snapshot).includes(folder.room);
  useSceneTextNode('office-carry-folder', held ? 'Held invoice folder' : 'Invoice folder on surface');
  useEffect(() => { invalidate(); }, [folder, invalidate]);
  useFrame(({ camera }) => {
    if (!group.current) return;
    group.current.visible = shown && (!held || camera.type === 'PerspectiveCamera');
    if (held) {
      group.current.position.copy(camera.localToWorld(offset.set(0.23, -0.32, -0.62)));
      group.current.quaternion.copy(camera.quaternion);
      group.current.rotateX(0.35);
    } else {
      group.current.position.set(...folder.position);
      group.current.rotation.set(0, -0.12, 0);
    }
  });
  return <group ref={group} name='prop:carry-folder'>
    <mesh renderOrder={held ? 100 : 0}>
      <boxGeometry args={[0.28, 0.025, 0.36]} /><meshStandardMaterial color='#bdac89' roughness={1} depthTest={!held} />
    </mesh>
    <mesh position={[0, 0.017, -0.01]} renderOrder={held ? 101 : 0}>
      <boxGeometry args={[0.24, 0.008, 0.28]} /><meshStandardMaterial color='#f3dfb9' roughness={1} depthTest={!held} />
    </mesh>
    <mesh position={[-0.07, 0.025, 0.12]} renderOrder={held ? 102 : 0}>
      <boxGeometry args={[0.08, 0.008, 0.05]} /><meshStandardMaterial color='#a9bc8f' depthTest={!held} />
    </mesh>
  </group>;
}
