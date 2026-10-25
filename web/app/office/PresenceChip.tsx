'use client';

import './presence.css';
import type { PresencePeer } from '../../lib/office/presence';

function modeLabel(mode: PresencePeer['mode']) { return mode === 'play' ? 'playing' : mode === 'tour' ? 'touring' : 'watching'; }
export function PresenceChip({ enabled, setEnabled, peers, selfName, mode }: {
  enabled: boolean; setEnabled: (enabled: boolean) => void; peers: PresencePeer[]; selfName: string; mode: PresencePeer['mode'];
}) {
  const viewers = [{ name: selfName, mode: modeLabel(mode) }, ...peers.map(peer => ({ name: peer.name, mode: modeLabel(peer.mode) }))];
  return <>
    <label className='presence-toggle'><input type='checkbox' checked={enabled} onChange={event => setEnabled(event.target.checked)} />Show Viewers</label>
    {enabled && <span className='presence-chip' aria-label={`${viewers.length} viewing: ${viewers.map(viewer => `${viewer.name} (${viewer.mode})`).join(', ')}`} title={viewers.map(viewer => `${viewer.name} (${viewer.mode})`).join(', ')}>{viewers.length} viewing</span>}
  </>;
}
