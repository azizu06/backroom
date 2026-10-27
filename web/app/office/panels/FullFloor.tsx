'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { fullFloorSummary } from '../../../lib/office/full-floor';
import type { OfficeSnapshot } from '../../../lib/office/state';

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <section className='full-floor-disclosure'>
    <h3><button type='button' aria-expanded={open} aria-controls={id} onClick={event => {
      const sheet = event.currentTarget.closest('.detail-sheet');
      const top = sheet?.scrollTop ?? 0;
      flushSync(() => setOpen(value => !value));
      if (sheet) sheet.scrollTop = top;
    }}><span aria-hidden='true'>{open ? '−' : '+'}</span> {title}</button></h3>
    <div id={id}>{open && children}</div>
  </section>;
}

export function FullFloor({ snapshot, workday, handoffs, receipts, controls }: {
  snapshot: OfficeSnapshot; workday: ReactNode; handoffs: ReactNode; receipts: ReactNode; controls: ReactNode;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const summary = fullFloorSummary(snapshot, now);
  return <div className='full-floor'>
    {summary.warnings.length > 0 && <aside className='full-floor-warnings' aria-label='Active warnings' role='status'>
      <strong>Needs attention</strong>
      <ul>{summary.warnings.map(warning => <li key={warning.id}>{warning.text}</li>)}</ul>
    </aside>}
    <section className='full-floor-summary' aria-label='Today at Backroom' data-testid='full-floor-summary'>
      <h3>Today at Backroom</h3>
      <dl className='full-floor-counters'>
        <div><dt>Inbox</dt><dd>{summary.counters.inbox}</dd></div>
        <div><dt>Handoffs in progress</dt><dd>{summary.counters.handoffs}</dd></div>
        <div><dt>Audit entries</dt><dd>{summary.counters.audit}</dd></div>
      </dl>
      <ul className='full-floor-roster' aria-label='Agent roster'>{summary.roster.map(card => <li key={card.agentId} data-agent-id={card.agentId}>
        <strong>{card.title}</strong><span className='full-floor-tag' data-tag={card.tag}>{card.tag}</span>
        <p>{card.line}</p>
      </li>)}</ul>
      {!summary.roster.length && <p>No seated agents are available.</p>}
    </section>
    <div className='full-floor-details'>
      <Disclosure title='Workday'>{workday || <p>Workday is unavailable for this recording.</p>}</Disclosure>
      <Disclosure title='Handoff history'>{handoffs}</Disclosure>
      <Disclosure title='Receipts and scenarios'>{receipts}</Disclosure>
      <Disclosure title='Controls'>{controls || <p>No additional controls in this view.</p>}</Disclosure>
    </div>
  </div>;
}
