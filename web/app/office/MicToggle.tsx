'use client';

import type { VoiceState } from './useProximityVoice';
import type { VoiceLevel } from '../../lib/office/voice';
import './voice.css';

const LABELS: Record<VoiceState, string> = {
  off: 'Voice chat off',
  asking: 'Allow the microphone in your browser…',
  on: 'Voice chat on · nearby people in Play hear you',
  denied: 'Microphone blocked · allow it in the address bar, then click again',
  unavailable: 'Voice chat unavailable here',
};

/**
 * Proximity voice: one click asks the browser for the microphone, then you talk and hear. Headphones avoid echo.
 * `level` is your own loudness while you talk: the button's ring grows with it.
 */
export function MicToggle({ state, toggle, level = 0 }: { state: VoiceState; toggle: () => void; level?: VoiceLevel }) {
  const on = state === 'on';
  return <button type='button' className='office-mic-toggle' aria-pressed={on} data-voice={state} data-level={on ? level : undefined} onClick={toggle}
    aria-label={LABELS[state]} title={`${LABELS[state]}${on ? '' : '. Headphones avoid echo.'}`}>
    <svg width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'>
      <rect x='9' y='3' width='6' height='11' rx='3' fill={on ? 'currentColor' : 'none'} />
      <path d='M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21' />
      {!on && <path d='M4 4l16 16' />}
    </svg>
  </button>;
}
