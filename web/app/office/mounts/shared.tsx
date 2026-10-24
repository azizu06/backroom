'use client';

import { useSyncExternalStore } from 'react';
import { Instance } from '@react-three/drei';
import { REDUCED_MOTION_QUERY } from '../../../lib/office/a11y';

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
export function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches, () => false);
}

/** One box of the scene's shared <Instances>; only valid inside an `instanced` mount (or scene.tsx itself). */
export function Block({ at, size, color, rotation = 0 }: { at: [number, number, number]; size: [number, number, number]; color: string; rotation?: number }) {
  return <Instance position={at} rotation={[0, rotation, 0]} scale={size} color={color} />;
}
