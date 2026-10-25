'use client';

import { useSyncExternalStore } from 'react';

let enabled = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Session-only, off by default. Shared by the lazy canvas and the corner menu. */
export const rainSetting = {
  getSnapshot: () => enabled,
  subscribe,
  setEnabled(next: boolean) {
    if (enabled === next) return;
    enabled = next;
    listeners.forEach(listener => listener());
  },
};

export function useRainEnabled(): boolean {
  return useSyncExternalStore(subscribe, rainSetting.getSnapshot, () => false);
}
