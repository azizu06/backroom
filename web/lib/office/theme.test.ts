import { describe, expect, it } from 'vitest';
import { THEME_PREFERENCE_KEY, applyTheme, nextTheme, themePreference, writeThemePreference } from './theme';

describe('office theme preference', () => {
  it('defaults to light and reads a saved dark theme', () => {
    expect(themePreference({ getItem: () => null })).toBe('light');
    expect(themePreference({ getItem: () => 'nonsense' })).toBe('light');
    expect(themePreference({ getItem: key => (key === THEME_PREFERENCE_KEY ? 'dark' : null) })).toBe('dark');
  });
  it('survives storage that throws', () => {
    expect(themePreference({ getItem: () => { throw new Error('blocked'); } })).toBe('light');
    expect(() => writeThemePreference('dark', { setItem: () => { throw new Error('blocked'); } })).not.toThrow();
  });
  it('writes the chosen theme and toggles', () => {
    const saved: Record<string, string> = {};
    writeThemePreference('dark', { setItem: (key, value) => { saved[key] = value; } });
    expect(saved[THEME_PREFERENCE_KEY]).toBe('dark');
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
  });
  it('shares the root layout key and values', () => {
    expect(THEME_PREFERENCE_KEY).toBe('backroom-theme');
    const saved: Record<string, string> = {};
    writeThemePreference('light', { setItem: (key, value) => { saved[key] = value; } });
    expect(saved).toEqual({ 'backroom-theme': 'light' });
  });
  it('applies the theme to the document root and every office shell', () => {
    const root = { dataset: {} as DOMStringMap };
    const shells = [{ dataset: {} as DOMStringMap }, { dataset: { theme: 'light' } as DOMStringMap }];
    applyTheme('dark', root, shells);
    expect(root.dataset.theme).toBe('dark');
    expect(shells.map(shell => shell.dataset.theme)).toEqual(['dark', 'dark']);
  });
});
