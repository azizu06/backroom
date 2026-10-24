import type { ReactNode } from 'react';
import './RouteState.css';

/** Shared fallback for 404 and error states on every non-office page. No hooks, so server and client files can both use it. */
export function RouteState({ status, title, children, reference, actions }: {
  status: string; title: string; children: ReactNode; reference?: string; actions?: ReactNode;
}) {
  return <main className="route-state">
    <div className="route-state-content">
      <header><a href="/office">Backroom</a><a href="/audit">Audit wall</a></header>
      <p className="route-state-status">{status}</p>
      <h1>{title}</h1>
      <div className="route-state-body">{children}</div>
      {reference && <p className="route-state-reference">Reference <code>{reference}</code></p>}
      <nav aria-label="Recovery" className="route-state-actions">
        {actions}
        <a href="/office">Back to the office</a>
        <a href="/audit">Open the audit wall</a>
      </nav>
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
