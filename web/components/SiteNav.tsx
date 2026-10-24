'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { isActive, navLinks } from '../lib/site-nav';
import './SiteNav.css';

export function SiteNav() {
  return <Suspense fallback={null}><SiteNavContent /></Suspense>;
}

function SiteNavContent() {
  const pathname = usePathname();
  const embedded = useSearchParams().get('embed') === '1';
  if (embedded || pathname.startsWith('/pay/')) return null;
  return <nav className='site-nav' aria-label='Site'>
    <Link className='site-nav-brand' href='/start' aria-current={isActive(pathname, '/start') ? 'page' : undefined}>Backroom</Link>
    <ul>
      {navLinks.map(({ label, href }) => <li key={href}>
        <Link href={href} aria-current={isActive(pathname, href) ? 'page' : undefined}>{label}</Link>
      </li>)}
    </ul>
  </nav>;
}
