'use client';

import { useSyncExternalStore } from 'react';
import { REDUCED_MOTION_QUERY } from '../../../lib/office/a11y';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** Same reduced-motion subscription as scene.tsx, shared by office props. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(REDUCED_MOTION_QUERY).matches, () => false);
}
