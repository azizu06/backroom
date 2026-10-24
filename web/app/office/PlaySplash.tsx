'use client';

import { useEffect, useId, useRef } from 'react';
import { isCloseKey } from '../../lib/office/a11y';
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
 * gesture, so first person starts from this click or Enter key.
 */
export function PlaySplash({ onEnter, onOverview }: { onEnter: () => void; onOverview: () => void }) {
  const titleId = useId();
  const enter = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { enter.current?.focus({ preventScroll: true }); }, []);
  // Enter starts Play even when focus has wandered off every control (e.g. a click on the backdrop).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isCloseKey(event.key)) { event.preventDefault(); onOverview(); return; }
      if (event.key === 'Tab') {
        // Modal: keep Tab and Shift+Tab on the splash buttons, even if focus already left them.
        const stops = Array.from(root.current?.querySelectorAll<HTMLElement>('button') ?? []);
        if (!stops.length) return;
        const at = stops.indexOf(document.activeElement as HTMLElement);
        const next = at < 0 ? (event.shiftKey ? stops.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length;
        event.preventDefault();
        stops[next]?.focus({ preventScroll: true });
        return;
      }
      if (event.key !== 'Enter' || event.repeat || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && target !== document.body && !target.closest('.play-splash')) return;
      if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) return;
      event.preventDefault();
      onEnter();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onEnter, onOverview]);
  return <div className='play-splash' role='dialog' aria-modal='true' aria-labelledby={titleId} data-testid='play-splash' ref={root}>
    <div className='play-splash-card'>
      <p className='play-splash-kicker'>Enter the office</p>
      <h2 id={titleId}>Backroom</h2>
      <p className='play-splash-pitch'>Walk the floor of an AI back office: agents work, policy decides, and every receipt is on the wall.</p>
      <button ref={enter} type='button' className='play-splash-enter' onClick={onEnter}>Enter</button>
      <ul className='play-splash-controls' aria-label='Controls'>
        {CONTROLS.map(([keys, action]) => <li key={keys}><kbd>{keys}</kbd><span>{action}</span></li>)}
      </ul>
      <button type='button' className='play-splash-overview' onClick={onOverview}>Overview (map view)</button>
    </div>
  </div>;
}
