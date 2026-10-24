'use client';
import { AskWhyVoice } from '../../components/AskWhyVoice';
import { AuditWall } from '../../components/AuditWall';
import './lobby.css';

/** Read-only lobby: the server's audit record plus ask-why. Answers cite entries; they never approve or pay. */
export function OfficeLobby() {
  return <>
    <h2 className='office-lobby-title'>Lobby audit wall <span>Server decision record · read only</span></h2>
    <div className='office-lobby-grid'>
      <div className='office-lobby-wall' data-office-mount='audit-wall-live'><AuditWall /></div>
      <aside className='office-lobby-ask' data-office-mount='ask-why'><AskWhyVoice label='Ask why by voice' /></aside>
    </div>
  </>;
}
