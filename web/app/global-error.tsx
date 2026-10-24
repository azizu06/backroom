'use client';
import { useEffect } from 'react';
import { errorReference, RouteState } from '../components/RouteState';

// Replaces the root layout when it fails, so it renders its own document.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <html lang="en"><body style={{ margin: 0, background: '#0b141c' }}>
    <title>Something went wrong · Backroom</title>
    <RouteState status="Error · Backroom did not load" title="Backroom hit a problem." reference={errorReference(error)}
      actions={<button type="button" onClick={() => retry()}>Try again</button>}>
      <p role="alert">The app could not finish loading. This error made no payment, approval or policy change.</p>
      <p>Try again in a moment. If it keeps failing, open the audit wall directly.</p>
    </RouteState>
  </body></html>;
}
