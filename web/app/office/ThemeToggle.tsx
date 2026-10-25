'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OfficeTheme } from '../../lib/office/palette';
import { applyTheme, nextTheme, themePreference, writeThemePreference } from '../../lib/office/theme';

/** Light/dark theme, persisted per viewer under the shared 'backroom-theme' key and applied as [data-theme] on <html> and every office shell. */
export function useOfficeTheme(): [OfficeTheme, (theme: OfficeTheme) => void, () => void] {
  const [theme, setThemeState] = useState<OfficeTheme>('light');
  const [ready, setReady] = useState(false);
  useEffect(() => { setThemeState(themePreference()); setReady(true); }, []);
  useEffect(() => {
    if (!ready) return; // never overwrite the root layout's pre-paint theme with the SSR default
    applyTheme(theme, document.documentElement, document.querySelectorAll<HTMLElement>('.office-shell'));
  }, [theme, ready]);
  const setTheme = useCallback((value: OfficeTheme) => { setThemeState(value); writeThemePreference(value); }, []);
  const toggle = useCallback(() => {
    setThemeState(current => { const value = nextTheme(current); writeThemePreference(value); return value; });
  }, []);
  return [theme, setTheme, toggle];
}

/** Self-contained toggle; whichever build owns the office corner menu mounts it. */
export function ThemeToggle({ className = 'theme-toggle' }: { className?: string }) {
  const [theme, , toggle] = useOfficeTheme();
  const dark = theme === 'dark';
  return <button type='button' className={className} onClick={toggle} aria-pressed={dark}
    aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
    <span aria-hidden='true'>{dark ? '☀' : '☾'}</span>
  </button>;
}
