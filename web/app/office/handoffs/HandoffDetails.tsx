import type { PlayPanel } from '../../../lib/office/play';
import { HandoffText } from './HandoffText';

export function HandoffDetails({ handoff }: { handoff: NonNullable<PlayPanel['handoff']> }) {
  return <dl className='play-panel-handoff'>
    {handoff.correction && <div><dt>Type</dt><dd>Correction</dd></div>}
    <div><dt>From</dt><dd>{handoff.from}</dd></div><div><dt>To</dt><dd>{handoff.to}</dd></div>
    <div><dt>Case</dt><dd>{handoff.caseDisplayId}</dd></div>
    <div><dt>Reason</dt><dd><HandoffText text={handoff.reason} /></dd></div>
    <div><dt>Status</dt><dd>{handoff.status}</dd></div>
    <div><dt>Summary</dt><dd><HandoffText text={handoff.summary} /></dd></div>
    {handoff.errorCode && <div><dt>Error</dt><dd>{handoff.errorCode}</dd></div>}
  </dl>;
}
