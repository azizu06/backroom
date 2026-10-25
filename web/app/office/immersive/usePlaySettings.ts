'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_PLAY_SETTINGS, loadPlaySettings, savePlaySettings, type PlaySettings } from '../../../lib/office/playSettings';

/** localStorage can be missing or throw (private windows, blocked site data). */
function viewerStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

let current: PlaySettings | null = null;
const listeners = new Set<() => void>();
function read(): PlaySettings { return current ??= loadPlaySettings(viewerStorage()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Per-viewer Play settings (persisted in this browser), shared by every component that reads them. */
export const playSettingsStore = {
  get: read,
  set(next: PlaySettings): void {
    current = next;
    savePlaySettings(viewerStorage(), next);
    listeners.forEach(listener => listener());
  },
  subscribe,
};

export function usePlaySettings(): [PlaySettings, (next: PlaySettings) => void] {
  const settings = useSyncExternalStore(subscribe, read, () => DEFAULT_PLAY_SETTINGS);
  const change = useCallback((next: PlaySettings) => playSettingsStore.set(next), []);
  return [settings, change];
}

/** The look sensitivity multiplier and its setter (the exported setting the HUD slider drives). */
export function useLookSensitivity(): [number, (multiplier: number) => void] {
  const [settings, change] = usePlaySettings();
  const set = useCallback((sensitivity: number) => change({ ...playSettingsStore.get(), sensitivity }), [change]);
  return [settings.sensitivity, set];
}
