'use client';
import { useEffect } from 'react';
import { errorReference, RouteState } from '../components/RouteState';

// Replaces the root layout when it fails, so it renders its own document and a minimal header.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <html lang="en"><body style={{ margin: 0 }}>
    <title>Something went wrong · Backroom</title>
    <RouteState standalone status="Error · Backroom did not load" title="Backroom hit a problem." reference={errorReference(error)}
      actions={<button type="button" onClick={() => retry()}>Try again</button>}>
      <p role="alert">Rendering failed. An action may already have completed. Check the audit record (/audit) before retrying.</p>
    </RouteState>
  </body></html>;
}
