import { handoffGroups, handoffLine, type Handoff } from '../../../lib/office/handoffs';
import { HandoffText } from './HandoffText';

/** Case groups in global sequence order. The parent owns the single accessible live log. */
export function HandoffEntries({ rows }: { rows: readonly Handoff[] }) {
  return handoffGroups(rows).map(group => <li key={group.caseDisplayId}>
    <strong>{group.caseDisplayId || 'Case'}</strong>
    <ol aria-label={`Handoffs for ${group.caseDisplayId || 'case'}`}>
      {group.rows.map(row => <li key={row.handoffId} data-status={row.status} data-correction={row.correction}>
        <HandoffText text={handoffLine(row)} />
      </li>)}
    </ol>
  </li>);
}
