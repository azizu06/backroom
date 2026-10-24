import { latestLobbyDecisions } from '../../../lib/office/lobby-v2';
import type { OfficeSnapshot } from '../../../lib/office/state';

export function LobbyFeed({ snapshot }: { snapshot: OfficeSnapshot }) {
  const entries = latestLobbyDecisions(snapshot);
  return <section className='lobby-v2-panel' aria-labelledby='lobby-feed-title'>
    <h3 id='lobby-feed-title'>What happened</h3>
    {entries.length ? <ol className='lobby-v2-feed'>{entries.map(entry => <li key={entry.id}>
      <a href={`/audit?entry=${encodeURIComponent(entry.id)}#audit-replay`} aria-label={`${entry.decision}: ${entry.ruleIds.join(', ') || 'no rule recorded'}`}>
        <strong>{entry.decision}</strong><span>{entry.ruleIds.join(' · ') || 'No rule recorded'}</span>
      </a>
    </li>)}</ol> : <p role='status'>No decisions received.</p>}
  </section>;
}
