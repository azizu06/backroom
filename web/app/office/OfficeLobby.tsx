'use client';
import { useState } from 'react';
import { AskWhyVoice } from '../../components/AskWhyVoice';
import { AuditWall } from '../../components/AuditWall';
import './lobby.css';

/** Read-only lobby: the server's audit record plus ask-why. Answers cite entries; they never approve or pay. */
export function OfficeLobby() {
  const [chainValid, setChainValid] = useState(true);
  return <>
    <h2 className='office-lobby-title'>Lobby audit wall <span>Server decision record · read only</span></h2>
    <div className='office-lobby-grid'>
      <div className='office-lobby-wall' data-office-mount='audit-wall-live'><AuditWall onChainChange={setChainValid} showAsk={false} headingLevel={3} /></div>
      <aside className='office-lobby-ask' data-office-mount='ask-why'><AskWhyVoice label='Ask why by voice' disabled={!chainValid}
        disabledReason='The audit chain is broken, so ask-why is paused (AUDIT_CHAIN_BROKEN).' /></aside>
    </div>
  </>;
}
