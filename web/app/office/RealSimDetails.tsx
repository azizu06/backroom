'use client';

import { useId, useState } from 'react';
import { OfficeChromeIcon } from '../../components/OfficeChromeIcon';
import { DisclosureRow, useDemoStatus } from '../../components/RealVsSim';
import { disclosureItems } from '../../lib/real-vs-sim';

/** Compact service status tile (same rows as /real-vs-sim), with a Details dropdown for the live rows. */
export function RealSimDetails() {
  const [open, setOpen] = useState(false);
  const status = useDemoStatus();
  const bodyId = useId();
  return <aside className='real-sim-tile' data-open={open} aria-label='System Status'>
    <header className='real-sim-tile-head'>
      <div>
        <strong>Info</strong>
        <span className='real-sim-tile-note'>{status ? (status.llmEnabled ? 'Models on' : 'Models off · model work paused') : 'Live status unavailable'}</span>
      </div>
      <button type='button' className='real-sim-tile-toggle' aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(value => !value)}>
        Details<OfficeChromeIcon name='caret-up' className='real-sim-tile-caret' />
      </button>
    </header>
    <div id={bodyId} className='real-sim-tile-body' hidden={!open}>
      {(['real', 'sandbox'] as const).map(kind => <section key={kind} aria-label={kind === 'real' ? 'Live services' : 'Partner services'}>
        <h3>{kind === 'real' ? 'Live services' : 'Partner services'}</h3>
        <ul>{disclosureItems.filter(item => item.kind === kind).map(item => <DisclosureRow key={item.id} item={item} status={status} detailed={false} />)}</ul>
      </section>)}
      <p className='real-sim-tile-foot'><a href='/real-vs-sim'>System Status ↗</a></p>
    </div>
  </aside>;
}
