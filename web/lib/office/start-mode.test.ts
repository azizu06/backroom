import { describe, expect, it, vi } from 'vitest';
import { SPLASH_SEEN_KEY, START_VIEW_KEY, markSplashSeen, readStartView, saveStartView, splashSeen, startView } from './start-mode';

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('office start view', () => {
  it('opens first-time desktop viewers in Play', () => {
    expect(startView({ search: '', stored: null, compact: false })).toBe('play');
  });
  it('returns viewers to the view they last chose', () => {
    expect(startView({ search: '', stored: 'overview', compact: false })).toBe('overview');
    expect(startView({ search: '', stored: 'play', compact: false })).toBe('play');
    expect(startView({ search: '', stored: 'garbage', compact: false })).toBe('play');
  });
  it('lets ?view= override storage and device', () => {
    expect(startView({ search: '?view=overview', stored: 'play', compact: false })).toBe('overview');
    expect(startView({ search: '?view=play', stored: 'overview', compact: false })).toBe('play');
    expect(startView({ search: '?view=play', stored: null, compact: true })).toBe('play');
    expect(startView({ search: new URLSearchParams('view=overview'), stored: null, compact: false })).toBe('overview');
    expect(startView({ search: '?view=orbit', stored: 'overview', compact: false })).toBe('overview');
  });
  it('starts phones in the overview even after a Play visit', () => {
    expect(startView({ search: '', stored: null, compact: true })).toBe('overview');
    expect(startView({ search: '', stored: 'play', compact: true })).toBe('overview');
  });
  it('keeps replay and story mode in the overview, whatever else is set', () => {
    expect(startView({ search: '?replay=core-offline', stored: 'play', compact: false })).toBe('overview');
    expect(startView({ search: '?replay=core-offline&view=play', stored: null, compact: false })).toBe('overview');
    expect(startView({ search: '?demo=story', stored: 'play', compact: false })).toBe('overview');
    expect(startView({ search: '?demo=other', stored: null, compact: false })).toBe('play');
  });
});

describe('office start view storage', () => {
  it('reads and writes office.start', () => {
    const storage = memory();
    expect(readStartView(storage)).toBeNull();
    saveStartView('overview', storage);
    expect(storage.getItem(START_VIEW_KEY)).toBe('overview');
    expect(readStartView(storage)).toBe('overview');
    expect(readStartView(memory({ [START_VIEW_KEY]: 'nope' }))).toBeNull();
  });
  it('survives missing or blocked storage', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readStartView(blocked)).toBeNull();
    expect(() => saveStartView('play', blocked)).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    try {
      expect(readStartView()).toBeNull();
      expect(() => saveStartView('play')).not.toThrow();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('office splash once per session', () => {
  it('is unseen until marked, then stays seen', () => {
    const storage = memory();
    expect(splashSeen(storage)).toBe(false);
    markSplashSeen(storage);
    expect(storage.getItem(SPLASH_SEEN_KEY)).toBe('1');
    expect(splashSeen(storage)).toBe(true);
  });
  it('treats unavailable storage as unseen without throwing', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(splashSeen(broken)).toBe(false);
    expect(() => markSplashSeen(broken)).not.toThrow();
  });
});
