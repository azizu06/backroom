import type { OfficeSnapshot } from '../../lib/office/state';

export function ReceiptList({ snapshot, title }: { snapshot: OfficeSnapshot; title: string }) {
  return <><h2>{title} <span>{snapshot.connection === 'preview' ? 'Local receipts' : snapshot.connection === 'replay' ? 'REPLAY receipts' : 'Subscribed receipts'}</span></h2>
    {!snapshot.audit.length ? <p>No decisions received.</p> : <ol>{snapshot.audit.slice(-20).reverse().map(entry => <li key={entry.id} data-audit-id={entry.id}>
      <strong className={entry.decision === 'DENY' ? 'denial-text' : ''}>{entry.decision}</strong> {entry.summary}<br /><code>{entry.id} · {entry.ruleIds.join(', ')}</code>
    </li>)}</ol>}</>;
}
