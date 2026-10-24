import { lobbyRoster } from '../../../lib/office/lobby-v2';
import type { AnchorId, OfficeSnapshot } from '../../../lib/office/state';

export function LobbyRoster({ snapshot, focus }: { snapshot: OfficeSnapshot; focus: (anchor: AnchorId) => void }) {
  const agents = lobbyRoster(snapshot);
  return <section className='lobby-v2-panel' aria-labelledby='lobby-roster-title'>
    <h3 id='lobby-roster-title'>Agent roster</h3>
    {agents.length ? <ul className='lobby-v2-roster'>{agents.map(agent => <li key={agent.id}>
      <div><strong>{agent.name}</strong><span>{agent.desk}</span><p>{agent.state}</p>
        {agent.badge ? <small>{agent.badge.actions.length} allowed actions · Policy v{agent.badge.policyVersion}</small> : <small>Badge unavailable</small>}</div>
      <button type='button' onClick={() => focus(agent.anchor)}>Find in office</button>
    </li>)}</ul> : <p role='status'>No seated agents are available.</p>}
  </section>;
}
