'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { InboxTray } from '../../components/InboxTray';
import type { InboxPreset } from '../../lib/inbox/types';
import { createSpacetimeOfficeState, type OfficeConnectionConfig } from '../../lib/office/spacetime';
import { INITIAL_OFFICE } from '../../lib/office/state';
import { Office } from './Office';
import { OfficeLobby } from './OfficeLobby';

export function LiveOffice({ config, presets, storyStart = false }: { config: OfficeConnectionConfig; presets: InboxPreset[]; storyStart?: boolean }) {
  const [source] = useState(() => createSpacetimeOfficeState(config));
  useEffect(() => { source.connect(); return source.disconnect; }, [source]);
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, () => INITIAL_OFFICE);
  return <Office source={source} storyStart={storyStart} auditWall={<OfficeLobby />} inboxTray={<>
    <p role='status'>Subscribed intake receipts · {snapshot.inboxCount}</p>
    <ul aria-label='Subscribed inbox receipts'>{snapshot.inboxReceipts?.slice(-10).reverse().map(row =>
      <li key={row.id} data-inbox-audit-id={row.id}><a href={`/audit?entry=${encodeURIComponent(row.id)}#audit-replay`}>{row.summary}</a> · {row.decision}</li>)}</ul>
    <InboxTray presets={presets} headingLevel={3} />
  </>} />;
}
