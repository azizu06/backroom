'use client';

import { useId, useState } from 'react';
import { OfficeChromeIcon } from '../../components/OfficeChromeIcon';
import { DisclosureRow, useDemoStatus } from '../../components/RealVsSim';
import { demoPillText, disclosureItems } from '../../lib/real-vs-sim';

/** Compact office disclosure: a small tile that always states the sandbox boundary, with a Details dropdown for the live rows. */
export function RealSimDetails() {
  const [open, setOpen] = useState(false);
  const status = useDemoStatus();
  const bodyId = useId();
  return <aside className='real-sim-tile' data-open={open} aria-label='Real versus simulated disclosure'>
    <header className='real-sim-tile-head'>
      <div>
        <strong>Info</strong>
        <span className='real-sim-tile-note'>{demoPillText(status)}</span>
      </div>
      <button type='button' className='real-sim-tile-toggle' aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(value => !value)}>
        Details<OfficeChromeIcon name='caret-up' className='real-sim-tile-caret' />
      </button>
    </header>
    <div id={bodyId} className='real-sim-tile-body' hidden={!open}>
      {(['real', 'sandbox'] as const).map(kind => <section key={kind} aria-label={kind === 'real' ? 'Real integrations' : 'Sandbox and simulated'}>
        <h3>{kind === 'real' ? 'Real' : 'Sandbox / simulated'}</h3>
        <ul>{disclosureItems.filter(item => item.kind === kind).map(item => <DisclosureRow key={item.id} item={item} status={status} detailed={false} />)}</ul>
      </section>)}
      <p className='real-sim-tile-foot'>Sandbox items never represent real money or identities. <a href='/real-vs-sim'>Full page ↗</a></p>
    </div>
  </aside>;
}
