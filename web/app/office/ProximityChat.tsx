'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { CHAT_MAX_LENGTH, PROXIMITY_RADIUS, onChatDraft } from '../../lib/office/proximity-chat';
import type { ChatSendResult, PlayChat } from './useProximityChat';
import './chat.css';

const STATUS: Record<Exclude<ChatSendResult, 'sent' | 'empty'>, string> = {
  off: 'Show coworkers to chat.',
  limited: 'Slow down · 1 message a second, 10 a minute.',
  unready: 'Still entering Play…',
};
const SHOWN = 6;

/** Play HUD chat box (initial bundle, no WebGL). Messages are rendered as plain text, never markup. */
export function ProximityChat({ chat, open, onOpen, onClose, hud }: {
  chat: PlayChat; open: boolean; onOpen: () => void; onClose: () => void; hud: RefObject<HTMLDivElement | null>;
}) {
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => onChatDraft(text => { setDraft(text); setStatus(''); openRef.current(); }), []);
  useEffect(() => { if (open && chat.presence) field.current?.focus(); }, [open, chat.presence]);
  function close() {
    setStatus('');
    onClose();
    hud.current?.focus();
  }
  function submit() {
    const result = chat.send(draft);
    if (result === 'sent') { setDraft(''); close(); return; }
    setStatus(result === 'empty' ? '' : STATUS[result]);
  }
  const recent = chat.log.slice(-SHOWN);
  return <section className='play-chat' aria-label='Proximity chat' data-open={open || undefined}>
    <ol className='play-chat-log' role='log' aria-label='Proximity chat messages' aria-live='polite'>
      {recent.map(entry => <li key={entry.id} data-self={entry.viewerId === chat.selfId || undefined}>
        <strong style={{ color: entry.color }}>{entry.viewerId === chat.selfId ? 'You' : entry.name}</strong> {entry.text}
      </li>)}
    </ol>
    {!chat.presence ? <p className='play-chat-off'>Chat needs coworkers on.{' '}
      <button type='button' onClick={() => { chat.showCoworkers(); if (!open) hud.current?.focus(); }}>Show coworkers</button>
    </p> : open ? <form className='play-chat-form' onSubmit={event => { event.preventDefault(); submit(); }}>
      <input ref={field} value={draft} maxLength={CHAT_MAX_LENGTH} aria-label={`Message viewers within ${PROXIMITY_RADIUS} m`} placeholder={`Say something · reaches ${PROXIMITY_RADIUS} m`}
        autoComplete='off' spellCheck onChange={event => { setDraft(event.target.value); setStatus(''); }}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }} />
      <span className='play-chat-count' aria-hidden='true'>{CHAT_MAX_LENGTH - draft.length}</span>
    </form> : <p className='play-chat-hint'>T · chat nearby</p>}
    {open && chat.presence && <p className='play-chat-status' role='status'>{status || 'Enter send · Esc close'}</p>}
  </section>;
}
