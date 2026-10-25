'use client';

import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import './DemoPill.css';

/** Fixed label for a replay, so a saved run is never mistaken for a live one. */
export function DemoPill() {
  return <Suspense fallback={null}><ReplayLabel /></Suspense>;
}

function ReplayLabel() {
  const pathname = usePathname() ?? '';
  const replay = useSearchParams().has('replay') && (pathname === '/office' || pathname === '/audit');
  if (!replay) return null;
  return <aside className="demo-pill demo-pill-fixed" aria-label="Replay disclosure">
    <strong>REPLAY</strong> · saved run · no live calls or payments
  </aside>;
}
