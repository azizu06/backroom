import type { PlayPanel } from '../../../lib/office/play';
import { HandoffDetails } from '../handoffs/HandoffDetails';
import { HandoffText } from '../handoffs/HandoffText';

/** The handoff record (details and case history); AgentTalkPanel shows it under the conversation. */
export function HandoffRecord({ panel }: { panel: PlayPanel }) {
  return <>
    {panel.handoff && <HandoffDetails handoff={panel.handoff} />}
    <ol className='play-panel-audit' aria-label='Case handoffs'>{panel.entries.map(entry => <li key={entry.id}>
      <strong className={entry.decision === 'REJECTED' ? 'denial-text' : ''}>{entry.decision}</strong> <HandoffText text={entry.summary} />
    </li>)}</ol>
  </>;
}
