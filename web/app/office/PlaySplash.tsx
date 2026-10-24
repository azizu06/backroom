'use client';

import { useEffect, useId } from 'react';
import { useModal } from './useModal';
import './splash.css';

const CONTROLS: readonly (readonly [keys: string, action: string])[] = [
  ['WASD / arrows', 'move'],
  ['Mouse or drag', 'look'],
  ['E', 'interact'],
  ['M', 'map'],
  ['Esc', 'leave'],
];

/**
 * "Enter the office" gate (initial bundle, no WebGL imports). Pointer lock and audio need a user
 * gesture, so first person starts from this click or Enter key. Focus, Tab, Escape and the inert
 * background come from useModal.
 */
export function PlaySplash({ onEnter, onOverview }: { onEnter: () => void; onOverview: () => void }) {
  const titleId = useId();
  const ref = useModal<HTMLDialogElement>(onOverview);
  // Enter starts Play even when focus has wandered off every control (e.g. a click on the backdrop).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter' || event.repeat || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && target !== document.body && !target.closest('.play-splash')) return;
      if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
      event.preventDefault();
      onEnter();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onEnter]);
  return <dialog className='play-splash' aria-modal='true' aria-labelledby={titleId} data-testid='play-splash' ref={ref}>
    <div className='play-splash-card'>
      <p className='play-splash-kicker'>Enter the office</p>
      <h2 id={titleId}>Backroom</h2>
      <p className='play-splash-pitch'>Walk the floor of an AI back office: agents work, policy decides, and every receipt is on the wall.</p>
      <button type='button' className='play-splash-enter' onClick={onEnter}>Enter</button>
      <ul className='play-splash-controls' aria-label='Controls'>
        {CONTROLS.map(([keys, action]) => <li key={keys}><kbd>{keys}</kbd><span>{action}</span></li>)}
      </ul>
      <button type='button' className='play-splash-overview' onClick={onOverview}>Overview (map view)</button>
    </div>
  </dialog>;
}
