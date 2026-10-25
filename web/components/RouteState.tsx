import type { ReactNode } from 'react';
import './RouteState.css';

/**
 * Shared fallback for 404 and error states. No hooks, so server and client files can both use it.
 * The root layout's SiteNav owns page navigation. `standalone` is only for global-error, which replaces that layout.
 */
export function RouteState({ status, title, children, reference, actions, standalone = false }: {
  status: string; title: string; children: ReactNode; reference?: string; actions?: ReactNode; standalone?: boolean;
}) {
  // One in-content link, and not a nav landmark. The standalone header already links home.
  const home = standalone ? null : <a href="/office">Back to the office</a>;
  return <main className="route-state">
    {standalone && <header className="route-state-bar">
      <a href="/office">Backroom</a>
      <a href="/audit">Audit Wall</a>
    </header>}
    <div className="route-state-content">
      <p className="route-state-status">{status}</p>
      <h1>{title}</h1>
      <div className="route-state-body">{children}</div>
      {reference && <p className="route-state-reference">Reference <code>{reference}</code></p>}
      {(actions || home) && <div className="route-state-actions">{actions}{home}</div>}
      <footer>Northfield Studio · Every agent decision stays on the audit wall.</footer>
    </div>
  </main>;
}

/** Only a server digest is safe to show: production hides server messages, and client messages may carry details. */
export function errorReference(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return undefined;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && /^[\w-]{1,64}$/.test(digest) ? digest : undefined;
}
