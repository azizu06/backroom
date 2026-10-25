'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OfficeTheme } from '../../lib/office/palette';
import { nextTheme, themePreference, writeThemePreference } from '../../lib/office/theme';

/** Light/dark office chrome theme, persisted per viewer and applied as [data-theme] on every office shell. */
export function useOfficeTheme(): [OfficeTheme, (theme: OfficeTheme) => void, () => void] {
  const [theme, setThemeState] = useState<OfficeTheme>('light');
  useEffect(() => { setThemeState(themePreference()); }, []);
  useEffect(() => {
    for (const shell of document.querySelectorAll<HTMLElement>('.office-shell')) shell.dataset.theme = theme;
  }, [theme]);
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
