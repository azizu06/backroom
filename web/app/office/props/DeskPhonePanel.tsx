'use client';

import { useState, useSyncExternalStore } from 'react';
import { CALL_DISCLOSURE, CALL_UNLOCK_PATH, callStore, requestCall, type CallRequestResult } from '../../../lib/office/calls';
import './desk-phone.css';

export function DeskPhonePanel() {
  const call = useSyncExternalStore(callStore.subscribe, callStore.getSnapshot, callStore.getServerSnapshot);
  const [result, setResult] = useState<CallRequestResult>();
  const agent = call.agentName ?? (call.speakingAgentId === 'collections' ? 'Collections' : call.speakingAgentId ?? 'Agent');
  const status = call.status === 'idle' ? 'Idle · no call' : call.status === 'ringing' ? `Ringing · ${call.callerLabel ?? 'Unknown caller'}`
    : call.status === 'live' ? call.speakingAgentId ? `Live · ${agent} speaking` : 'Live · connected' : `Ended · ${call.endReason ?? 'Call ended'}`;
  return <div className='desk-phone-panel'>
    <p role='status' data-testid='phone-status'>{status}</p>
    <div aria-live='polite' aria-relevant='additions text'><ol tabIndex={0} aria-label='Call transcript' data-testid='phone-transcript'>
      {call.transcript.map(line => <li key={line.id}><strong>{line.speaker === 'agent' ? line.agentId === 'collections' ? 'Collections' : agent : call.callerLabel ?? 'Caller'}</strong>: {line.text}</li>)}
    </ol></div>
    <p>{CALL_DISCLOSURE}</p>
    <button data-testid='phone-request' onClick={async () => setResult(await requestCall())}>Request call</button>
    {result && <p role='status' data-testid='phone-request-result'>{result.message}{result.reason === 'locked' && <> <a href={CALL_UNLOCK_PATH}>Unlock calls</a></>}</p>}
  </div>;
}
