'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { isActive, navLinks, PAYMENT_LINK_HREF, siteNavHidden, whatsRealLink, type SiteNavPlacement } from '../lib/site-nav';
import { applyTheme, readTheme, type Theme } from '../lib/theme';
import { useActivePaymentLink } from './useActivePaymentLink';
import './SiteNav.css';

export function SiteNav({ placement = 'layout' }: { placement?: SiteNavPlacement }) {
  return <Suspense fallback={null}><SiteNavContent placement={placement} /></Suspense>;
}

function SiteNavContent({ placement }: { placement: SiteNavPlacement }) {
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const hidden = siteNavHidden(pathname, params?.get('embed') ?? null, placement);
  // A live payment link lights up its nav item. The office kiosk and replays show their own state, so only live pages poll.
  const { link } = useActivePaymentLink({ enabled: !hidden && placement === 'layout' && !params?.has('replay'), intervalMs: 5000 });
  if (hidden) return null;
  const current = (href: string) => isActive(pathname, href) ? 'page' as const : undefined;
  const nav = <nav className='site-nav' aria-label='Site' data-placement={placement}>
    <Link className='site-nav-brand' href='/office'>Backroom</Link>
    <ul>
      {navLinks.map(({ label, href }) => {
        const ready = href === PAYMENT_LINK_HREF && !!link;
        return <li key={href}><Link href={href} aria-current={current(href)} data-ready={ready || undefined}>{label}{ready && <span className='site-nav-ready'> · ready</span>}</Link></li>;
      })}
    </ul>
    <Link className='site-nav-real' href={whatsRealLink.href} aria-current={current(whatsRealLink.href)}>{whatsRealLink.label}</Link>
  </nav>;
  // The theme switch sits beside the nav pill, as tall as the bar. The office has its own theme toggle.
  return placement === 'layout' ? <div className='site-nav-row'>{nav}<ThemeToggle /></div> : nav;
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>();
  useEffect(() => setTheme(readTheme()), []);
  if (!theme) return null;
  const next = theme === 'dark' ? 'light' : 'dark';
  return <button type='button' className='site-nav-theme' aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}
    onClick={() => { applyTheme(next); setTheme(next); }}>{theme === 'dark' ? '☀' : '☾'}</button>;
}
