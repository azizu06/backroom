import type { PlayPanel } from '../../../lib/office/play';
import { HandoffDetails } from '../handoffs/HandoffDetails';
import { HandoffText } from '../handoffs/HandoffText';
import type { PlayPanelView } from './types';

function HandoffPanel({ panel }: { panel: PlayPanel }) {
  return <>
    {panel.handoff && <HandoffDetails handoff={panel.handoff} />}
    <ol className='play-panel-audit' aria-label='Case handoffs'>{panel.entries.map(entry => <li key={entry.id}>
      <strong className={entry.decision === 'REJECTED' ? 'denial-text' : ''}>{entry.decision}</strong> <HandoffText text={entry.summary} />
    </li>)}</ol>
  </>;
}

export const handoffPanel: PlayPanelView = { Body: HandoffPanel, hideAudit: true, hideAskWhy: true };
