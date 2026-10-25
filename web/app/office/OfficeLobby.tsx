'use client';
import { useState } from 'react';
import { AskWhyVoice } from '../../components/AskWhyVoice';
import { AuditWall } from '../../components/AuditWall';
import PaymentLinkPanel from '../../components/PaymentLinkPanel';
import type { OfficeSnapshot, AnchorId } from '../../lib/office/state';
import { LobbyFeed } from './lobby/LobbyFeed';
import { LobbyStats } from './lobby/LobbyStats';
import './lobby.css';

/** Read-only lobby: the server's audit record, ask-why and the payment link kiosk. Answers cite entries; they never approve or pay. */
export function OfficeLobby({ snapshot, focus }: { snapshot: OfficeSnapshot; focus: (anchor: AnchorId) => void }) {
  const [chainValid, setChainValid] = useState(true);
  return <>
    {/* HUD variant (c): the seat status row above is the one roster; the strip keeps today's counts and the feed. */}
    <div className='office-lobby-v2'><LobbyStats snapshot={snapshot} /><LobbyFeed snapshot={snapshot} /></div>
    <h2 className='office-lobby-title'>Lobby audit wall <span>Server decision record · read only</span></h2>
    <div className='office-lobby-grid'>
      <div className='office-lobby-wall' data-office-mount='audit-wall-live'><AuditWall onChainChange={setChainValid} showAsk={false} headingLevel={3} /></div>
      <aside className='office-lobby-ask' data-office-mount='ask-why'><AskWhyVoice label='Ask why by voice' disabled={!chainValid}
        disabledReason='The audit chain is broken, so ask-why is paused (AUDIT_CHAIN_BROKEN).' /></aside>
      <aside className='office-lobby-pay' data-office-mount='payment-link' aria-label='Payment link kiosk'><PaymentLinkPanel /></aside>
    </div>
  </>;
}
