import type { OfficeTheme } from './palette';

/** Same key and values as the shared theme (web/app/theme.css, set before paint by the root layout). */
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

type ThemeTarget = { dataset: DOMStringMap };

/** Apply the theme to the document root (shared components follow it) and to every office shell. */
export function applyTheme(theme: OfficeTheme, root: ThemeTarget, shells: Iterable<ThemeTarget> = []): void {
  root.dataset.theme = theme;
  for (const shell of shells) shell.dataset.theme = theme;
}
