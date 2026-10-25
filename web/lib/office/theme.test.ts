import { describe, expect, it } from 'vitest';
import { THEME_PREFERENCE_KEY, nextTheme, themePreference, writeThemePreference } from './theme';

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
});
