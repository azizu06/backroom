'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { NavDisclosure } from './DemoPill';
import { isActive, navLinks, siteNavHidden, whatsRealLink, type SiteNavPlacement } from '../lib/site-nav';
import { applyTheme, readTheme, type Theme } from '../lib/theme';
import './SiteNav.css';

export function SiteNav({ placement = 'layout' }: { placement?: SiteNavPlacement }) {
  return <Suspense fallback={null}><SiteNavContent placement={placement} /></Suspense>;
}

function SiteNavContent({ placement }: { placement: SiteNavPlacement }) {
  const pathname = usePathname() ?? '';
  const embed = useSearchParams()?.get('embed') ?? null;
  if (siteNavHidden(pathname, embed, placement)) return null;
  const current = (href: string) => isActive(pathname, href) ? 'page' as const : undefined;
  return <nav className='site-nav' aria-label='Site'>
    <Link className='site-nav-brand' href='/office'>Backroom</Link>
    <ul>
      {navLinks.map(({ label, href }) => <li key={href}><Link href={href} aria-current={current(href)}>{label}</Link></li>)}
    </ul>
    <NavDisclosure />
    <Link className='site-nav-real' href={whatsRealLink.href} aria-current={current(whatsRealLink.href)}>{whatsRealLink.label}</Link>
    {/* The office has its own theme toggle. */}
    {placement === 'layout' && <ThemeToggle />}
  </nav>;
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>();
  useEffect(() => setTheme(readTheme()), []);
  if (!theme) return null;
  const next = theme === 'dark' ? 'light' : 'dark';
  return <button type='button' className='site-nav-theme' aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}
    onClick={() => { applyTheme(next); setTheme(next); }}>{theme === 'dark' ? '☀' : '☾'}</button>;
}
