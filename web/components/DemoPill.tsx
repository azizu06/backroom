'use client';

import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { demoPillText } from '../lib/real-vs-sim';
import { siteNavHidden } from '../lib/site-nav';
import { useDemoStatus } from './RealVsSim';
import './DemoPill.css';

function useReplay() {
  const pathname = usePathname() ?? '';
  return useSearchParams().has('replay') && (pathname === '/office' || pathname === '/audit');
}

/** Inline disclosure for the site nav: never presents simulated as live. Replays show their own label instead. */
export function NavDisclosure() {
  const replay = useReplay();
  // A replay makes no network requests, including this status poll.
  const status = useDemoStatus(!replay);
  if (replay) return null;
  return <span className="site-nav-note"><span className="demo-pill" role="note" aria-label="Demo disclosure">{demoPillText(status)}</span></span>;
}

/** Fixed disclosure for a replay, and for pages without the site nav (customer /pay/*, embeds). */
export function DemoPill() {
  return <Suspense fallback={null}><FixedDisclosure /></Suspense>;
}

function FixedDisclosure() {
  const pathname = usePathname() ?? '';
  const embed = useSearchParams().get('embed');
  const replay = useReplay();
  const shown = !replay && siteNavHidden(pathname, embed, 'office');
  const status = useDemoStatus(shown);
  if (replay) return <aside className="demo-pill demo-pill-fixed" aria-label="Replay disclosure">
    <strong>REPLAY</strong> · saved run · no live call or money movement
  </aside>;
  if (!shown) return null;
  return <aside className="demo-pill demo-pill-fixed" aria-label="Demo disclosure">
    {demoPillText(status)} · <a href="/real-vs-sim">What&rsquo;s real</a>
  </aside>;
}
