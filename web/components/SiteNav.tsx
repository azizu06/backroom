'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { isActive, navLinks, siteNavHidden, type SiteNavPlacement } from '../lib/site-nav';
import './SiteNav.css';

export function SiteNav({ placement = 'layout' }: { placement?: SiteNavPlacement }) {
  return <Suspense fallback={null}><SiteNavContent placement={placement} /></Suspense>;
}

function SiteNavContent({ placement }: { placement: SiteNavPlacement }) {
  const pathname = usePathname() ?? '';
  // Static renders of the office (and a missing router) have no search-param context.
  const params = useSearchParams();
  const embed = params?.get('embed') ?? null;
  if (siteNavHidden(pathname, embed, placement)) return null;
  return <nav className='site-nav' aria-label='Site'>
    <Link className='site-nav-brand' href='/start' aria-current={isActive(pathname, '/start') ? 'page' : undefined}>Backroom</Link>
    <ul>
      {navLinks.map(({ label, href }) => <li key={href}>
        <Link href={href} aria-current={isActive(pathname, href) ? 'page' : undefined}>{label}</Link>
      </li>)}
    </ul>
  </nav>;
}
