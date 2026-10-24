'use client';

import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { demoPillText } from '../lib/real-vs-sim';
import { siteNavHidden } from '../lib/site-nav';
import { useDemoStatus } from './RealVsSim';
import './DemoPill.css';

/** The one disclosure every page carries: never presents simulated as live. Links to the full breakdown where the site nav is hidden. */
export function DemoPill() {
  return <Suspense fallback={null}><DemoPillContent /></Suspense>;
}

function DemoPillContent() {
  const pathname = usePathname();
  const params = useSearchParams();
  const replay = params.has('replay') && (pathname === '/office' || pathname === '/audit');
  // A replay makes no network requests, including this status poll.
  const status = useDemoStatus(!replay);
  if (replay) return <aside className="demo-pill" aria-label="Replay disclosure">
    <strong>REPLAY</strong> · saved synthetic run · no live call or money movement
  </aside>;
  const officeView = pathname === '/' || pathname.startsWith('/office');
  return <>
    {/* Keeps the last controls of a scrolling page clear of the fixed pill. */}
    {!officeView && <div aria-hidden="true" className="demo-pill-spacer" />}
    <aside className="demo-pill" aria-label="Demo disclosure">
      {demoPillText(status)}
      {siteNavHidden(pathname, params.get('embed'), 'office') && <> · <a href="/real-vs-sim">What&rsquo;s real</a></>}
    </aside>
  </>;
}
