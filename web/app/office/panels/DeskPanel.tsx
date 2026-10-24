import type { PlayPanelView } from './types';

export const deskPanel: PlayPanelView = {
  Body: ({ panel }) => <>
    {panel.badge ? <>
      <p>Badge · policy version {panel.badge.policyVersion}</p>
      {panel.badge.limits.length ? <dl>{panel.badge.limits.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
        : <p>No monetary authority in this badge.</p>}
    </> : <p>No badge at this desk.</p>}
    {panel.seated && (panel.seated.length ? <ul aria-label='Seated agents'>{panel.seated.map(agent => <li key={agent.id}><strong>{agent.name}</strong> · {agent.state}</li>)}</ul>
      : <p>No agents seated here.</p>)}
  </>,
};
