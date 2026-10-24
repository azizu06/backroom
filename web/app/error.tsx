'use client';
import { useEffect } from 'react';
import { errorReference, RouteState } from '../components/RouteState';

// Inside the root layout, so the demo banner and Real-vs-Sim panel stay visible while this shows.
export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <RouteState status="Error · Page did not load" title="This page hit a problem." reference={errorReference(error)}
    actions={<button type="button" onClick={() => retry()}>Try again</button>}>
    <p role="alert">The page could not finish loading. This error made no payment, approval or policy change.</p>
    <p>Try again, or go back to the office. The audit wall keeps the record of every agent decision.</p>
  </RouteState>;
}
