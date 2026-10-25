'use client';

import { useId, type ReactNode } from 'react';
import { useModal } from './useModal';
import { OFFICE_ANCHORS, matchingDenial, type AnchorId, type OfficeSnapshot } from '../../lib/office/state';

function valueText(value: unknown): string {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
/** Display exact values from subscribed badge rows, never infer permission from the room. */
export function RoomInspector({ room, snapshot, close, inboxTray, openSheet }: {
  room: AnchorId; snapshot: OfficeSnapshot; close: () => void; inboxTray?: ReactNode; openSheet?: (sheet: 'inbox' | 'audit') => void;
}) {
  const modal = useModal<HTMLElement>(close);
  const headingId = useId();
  const badge = snapshot.badges.find(row => row.seatId === room);
  const denial = matchingDenial(snapshot, room);
  return <div className='detail-sheet-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <section ref={modal} className='room-inspector' role='dialog' aria-modal='true' aria-labelledby={headingId}>
    <header><h2 id={headingId}>{OFFICE_ANCHORS[room].name}</h2><button type='button' onClick={close} aria-label={`Close ${OFFICE_ANCHORS[room].name} details`}>×</button></header>
    <div>
    {badge ? <>
      <p>Policy version {badge.policyVersion}</p>
      <dl>{Object.entries(badge.limits).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{valueText(value)}</dd></div>)}</dl>
      <p><strong>Allowed rooms</strong><br />{badge.rooms.join(', ')}</p>
      <details><summary>Allowed Actions ({badge.actions.length})</summary><ul>{badge.actions.map(action => <li key={action}>{action}</li>)}</ul></details>
      {!Object.keys(badge.limits).length && <p>No monetary authority in this badge.</p>}
    </> : room === 'treasury' ? <p>Locked · Dana only. Entry and money movement require server authorization.</p>
      : room === 'dana' ? <p>Human review. Approvals require Dana’s passkey on the approval card.</p>
      : <><h3>Audit Wall</h3><p>{openSheet ? <button type='button' onClick={() => openSheet('audit')}>Open the Audit Wall</button> : <a href='#office-audit-wall'>Open the Audit Wall below</a>}</p>
        <div data-office-mount='inbox-inspector'><h3>Inbox Tray · {snapshot.inboxCount}</h3>{openSheet ? <button type='button' onClick={() => openSheet('inbox')}>Open the inbox tray</button> : inboxTray ? <a href='#office-inbox-tray'>Open the lobby tray below</a> : <><p>Receipts on the inbox page are not synced into this scene.</p><a href='/inbox'>Open the inbox</a></>}</div></>}
    {denial && <p className='denial-text' role='status'>Entry denied · audit {denial.auditId}</p>}
    </div>
  </section></div>;
}
