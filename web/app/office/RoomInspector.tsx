'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { isCloseKey } from '../../lib/office/a11y';
import { OFFICE_ANCHORS, matchingDenial, type AnchorId, type OfficeSnapshot } from '../../lib/office/state';

function valueText(value: unknown): string {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
/** Display exact values from subscribed badge rows, never infer permission from the room. */
export function RoomInspector({ room, snapshot, close, inboxTray }: {
  room: AnchorId; snapshot: OfficeSnapshot; close: () => void; inboxTray?: ReactNode;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  useEffect(() => { closeButton.current?.focus(); }, [room]);
  const badge = snapshot.badges.find(row => row.seatId === room);
  const denial = matchingDenial(snapshot, room);
  return <section className='room-inspector' role='dialog' aria-labelledby={headingId} onKeyDown={event => {
    if (isCloseKey(event.key)) { event.preventDefault(); close(); }
  }}>
    <header><h2 id={headingId}>{OFFICE_ANCHORS[room].name}</h2><button ref={closeButton} onClick={close} aria-label={`Close ${OFFICE_ANCHORS[room].name} details`}>×</button></header>
    {badge ? <>
      <p>Policy version {badge.policyVersion}</p>
      <dl>{Object.entries(badge.limits).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{valueText(value)}</dd></div>)}</dl>
      <p><strong>Allowed rooms</strong><br />{badge.rooms.join(', ')}</p>
      <details><summary>Allowed actions ({badge.actions.length})</summary><ul>{badge.actions.map(action => <li key={action}>{action}</li>)}</ul></details>
      {!Object.keys(badge.limits).length && <p>No monetary authority in this badge.</p>}
    </> : room === 'treasury' ? <p>Locked · Dana only. Entry and money movement require server authorization.</p>
      : room === 'dana' ? <p>Human review. Approvals require Dana’s passkey on the approval card.</p>
      : <><h3>Audit wall</h3><p><a href='#office-audit-wall'>Open the audit wall below</a></p>
        <div data-office-mount='inbox-inspector'><h3>Inbox tray · {snapshot.inboxCount}</h3>{inboxTray ? <a href='#office-inbox-tray'>Open the lobby tray below</a> : <><p>Receipts on the inbox page are not synced into this scene.</p><a href='/inbox'>Open the inbox</a></>}</div></>}
    {denial && <p className='denial-text' role='status'>Entry denied · audit {denial.auditId}</p>}
  </section>;
}
