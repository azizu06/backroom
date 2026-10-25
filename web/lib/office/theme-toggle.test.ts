import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import type { MouseEvent } from 'react';
import { ThemeToggle } from '../../app/office/ThemeToggle';

const setTheme = vi.hoisted(() => vi.fn());
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof React>();
  return { ...actual, useEffect: () => {}, useState: () => ['light', setTheme] };
});
Object.assign(globalThis, { React });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

function browser({ transitions, reduced }: { transitions: boolean; reduced: boolean }) {
  const dataset: Record<string, string> = {};
  const animate = vi.fn();
  const store = new Map<string, string>();
  const transition = vi.fn((update: () => void) => { update(); return { ready: Promise.resolve() }; });
  vi.stubGlobal('document', { documentElement: { dataset, animate }, startViewTransition: transitions ? transition : undefined });
  vi.stubGlobal('window', { matchMedia: () => ({ matches: reduced }) });
  vi.stubGlobal('innerWidth', 1000);
  vi.stubGlobal('innerHeight', 800);
  vi.stubGlobal('localStorage', { setItem: (key: string, value: string) => store.set(key, value) });
  const event = { currentTarget: { getBoundingClientRect: () => ({ left: 90, top: 40, width: 20, height: 20 }) } } as MouseEvent<HTMLButtonElement>;
  return { dataset, animate, transition, store, event };
}

describe('AJ office theme switch', () => {
  it.each([{ transitions: false, reduced: false }, { transitions: true, reduced: true }])('applies and persists the theme without animation for %o', options => {
    const env = browser(options);
    const onThemeChange = vi.fn();
    ThemeToggle({ onThemeChange })!.props.onClick(env.event);
    expect(env.dataset.theme).toBe('dark');
    expect(env.store.get('backroom-theme')).toBe('dark');
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(onThemeChange).toHaveBeenCalledWith('dark');
    expect(env.transition).not.toHaveBeenCalled();
    expect(env.animate).not.toHaveBeenCalled();
  });

  it('reveals the shared theme in a circle from the toggle', async () => {
    const env = browser({ transitions: true, reduced: false });
    const onThemeChange = vi.fn();
    ThemeToggle({ onThemeChange })!.props.onClick(env.event);
    await Promise.resolve();
    expect(env.dataset.theme).toBe('dark');
    expect(env.store.get('backroom-theme')).toBe('dark');
    expect(env.transition).toHaveBeenCalledOnce();
    expect(env.animate).toHaveBeenCalledWith({ clipPath: [
      'circle(0px at 100px 50px)', `circle(${Math.hypot(900, 750)}px at 100px 50px)`,
    ] }, expect.objectContaining({ duration: 520, pseudoElement: '::view-transition-new(root)' }));
  });
});
