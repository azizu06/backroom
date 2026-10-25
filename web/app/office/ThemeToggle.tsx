'use client';

import { useEffect, useState } from 'react';
import { applyTheme, readTheme, type Theme } from '../../lib/theme';

/** The office's own light/dark switch (SiteNav shows its toggle only outside /office). Same app-wide theme and key as #291's lib/theme. */
export function ThemeToggle({ className = 'theme-toggle' }: { className?: string }) {
  const [theme, setTheme] = useState<Theme>();
  useEffect(() => setTheme(readTheme()), []);
  if (!theme) return null;
  const next = theme === 'dark' ? 'light' : 'dark';
  return <button type='button' className={className} onClick={() => { applyTheme(next); setTheme(next); }} aria-pressed={theme === 'dark'}
    aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
    <span aria-hidden='true'>{theme === 'dark' ? '☀' : '☾'}</span>
  </button>;
}
