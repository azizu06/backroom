'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { flushSync } from 'react-dom';
import { applyTheme, readTheme, type Theme } from '../../lib/theme';
import { OfficeChromeIcon } from '../../components/OfficeChromeIcon';

/** The office's own light/dark switch (SiteNav shows its toggle only outside /office). Same app-wide theme and key as #291's lib/theme. */
export function ThemeToggle({ className = 'theme-toggle', onThemeChange }: { className?: string; onThemeChange?: (theme: Theme) => void }) {
  const [theme, setTheme] = useState<Theme>();
  useEffect(() => { const current = readTheme(); setTheme(current); onThemeChange?.(current); }, [onThemeChange]);
  if (!theme) return null;
  const next = theme === 'dark' ? 'light' : 'dark';
  function toggleTheme(event: MouseEvent<HTMLButtonElement>) {
    const apply = () => { applyTheme(next); setTheme(next); onThemeChange?.(next); };
    if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { apply(); return; }
    const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
    const x = left + width / 2, y = top + height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(() => flushSync(apply)).ready.then(() => {
      document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(.22, 1, .36, 1)', pseudoElement: '::view-transition-new(root)' });
    }).catch(() => { /* The theme still applies when the browser skips the animation. */ });
  }
  return <button type='button' className={className} onClick={toggleTheme} aria-pressed={theme === 'dark'}
    aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
    <OfficeChromeIcon name={theme === 'dark' ? 'sun' : 'moon'} />
  </button>;
}
