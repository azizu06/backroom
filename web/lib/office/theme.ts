import type { OfficeTheme } from './palette';

export const THEME_PREFERENCE_KEY = 'backroom-theme';

/** The viewer's saved office theme; light when nothing usable is stored or storage is unavailable. */
export function themePreference(storage?: Pick<Storage, 'getItem'>): OfficeTheme {
  try { return (storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage))?.getItem(THEME_PREFERENCE_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

export function writeThemePreference(value: OfficeTheme, storage?: Pick<Storage, 'setItem'>): void {
  try { (storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage))?.setItem(THEME_PREFERENCE_KEY, value); }
  catch { /* Storage can be unavailable in private or embedded contexts. */ }
}

export function nextTheme(theme: OfficeTheme): OfficeTheme { return theme === 'dark' ? 'light' : 'dark'; }
