'use client';
import { useEffect } from 'react';
import { errorReference, RouteState } from '../components/RouteState';

// Inside the root layout, so SiteNav stays the only navigation while this shows.
export default function RouteError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <RouteState status="Error · Page did not load" title="This page hit a problem." reference={errorReference(error)}
    actions={<button type="button" onClick={() => retry()}>Try again</button>}>
    <p role="alert">Rendering failed. An action may already have completed. Check the audit record (/audit) before retrying.</p>
  </RouteState>;
}
