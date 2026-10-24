import { lobbyModeLabel, lobbyStats } from '../../../lib/office/lobby-v2';
import type { OfficeSnapshot } from '../../../lib/office/state';

export function LobbyStats({ snapshot }: { snapshot: OfficeSnapshot }) {
  const stats = lobbyStats(snapshot);
  return <section className='lobby-v2-panel' aria-labelledby='lobby-stats-title'>
    <h3 id='lobby-stats-title'>Today at Backroom {lobbyModeLabel(snapshot.connection) && <span>{lobbyModeLabel(snapshot.connection)}</span>}</h3>
    <dl className='lobby-v2-stats'>
      <div><dt>Inbox items</dt><dd>{stats.inbox}</dd></div>
      <div><dt>Held for a human</dt><dd>{stats.held}</dd></div>
      <div><dt>DENY decisions</dt><dd>{stats.denied}</dd></div>
      <div><dt>Open escalations</dt><dd>{stats.escalations}</dd></div>
    </dl>
    {snapshot.connection === 'connecting' && <p role='status'>Waiting for office state…</p>}
    {snapshot.connection === 'disconnected' && <p role='status'>Showing the last received office snapshot.</p>}
  </section>;
}
