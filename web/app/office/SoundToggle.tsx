'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { OfficeSoundEngine } from '../../lib/office/sound-engine';
import { OFFICE_SOUND_EVENT, isOfficeCue } from '../../lib/office/sound-events';
import { cooldownFor, cuesFor, soundPreference, writeSoundPreference, type CueTimes, type OneShotCue } from '../../lib/office/sound';
import type { OfficeSnapshot } from '../../lib/office/state';
import { immersiveChannel } from './immersive/channel';
import './sound.css';

export function SoundToggle({ snapshot }: { snapshot: OfficeSnapshot }) {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const engine = useRef<OfficeSoundEngine | null>(null);
  const wanted = useRef(false);
  const previous = useRef(snapshot);
  const playedAt = useRef<CueTimes>({});

  const play = useCallback((kind: OneShotCue, now: number) => {
    if (now - (playedAt.current[kind] ?? -Infinity) < cooldownFor(kind)) return;
    if (engine.current?.play(kind)) playedAt.current[kind] = now;
  }, []);

  useEffect(() => {
    wanted.current = soundPreference() === 'on';
    setEnabled(wanted.current);
    setReady(true);
    engine.current = new OfficeSoundEngine();
    // Remember the label after reload, but allocate no AudioContext until a trusted click.
    const gesture = (event: MouseEvent) => { if (event.isTrusted && wanted.current) engine.current?.enable(); };
    const cue = (event: Event) => {
      const kind: unknown = (event as CustomEvent<unknown>).detail;
      // In Play the immersive engine voices footsteps with the floor's timbre.
      if (kind === 'step' && immersiveChannel.footsteps) return;
      if (isOfficeCue(kind)) play(kind, performance.now());
    };
    window.addEventListener('click', gesture);
    window.addEventListener(OFFICE_SOUND_EVENT, cue);
    return () => {
      window.removeEventListener('click', gesture);
      window.removeEventListener(OFFICE_SOUND_EVENT, cue);
      engine.current?.disable(); engine.current = null;
    };
  }, [play]);

  useEffect(() => {
    const now = performance.now();
    const cues = cuesFor(previous.current, snapshot, now, playedAt.current);
    previous.current = snapshot;
    for (const kind of cues) play(kind, now);
  }, [snapshot, play]);

  function toggle() {
    const next = !wanted.current;
    wanted.current = next;
    setEnabled(next);
    writeSoundPreference(next ? 'on' : 'off');
    if (next) engine.current?.enable();
    else engine.current?.disable();
  }

  return <button type='button' className='office-sound-toggle' aria-pressed={enabled} onClick={toggle} disabled={!ready}
    aria-label={enabled ? 'Sound on' : 'Sound off'} title={`${enabled ? 'Sound on' : 'Sound off'} · quiet office sounds. After reload, sound resumes on your next click.`}>
    <svg width='1em' height='1em' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true' focusable='false'>
      <path d='M4 9.5h3.5L12 5.5v13l-4.5-4H4z' fill='currentColor' />
      {enabled ? <path d='M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11' /> : <path d='M16 9.5l5 5M21 9.5l-5 5' />}
    </svg>
  </button>;
}
