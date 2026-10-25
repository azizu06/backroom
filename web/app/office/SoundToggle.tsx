'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { OfficeSoundEngine } from '../../lib/office/sound-engine';
import { OFFICE_SOUND_EVENT, isOfficeCue } from '../../lib/office/sound-events';
import { cooldownFor, cuesFor, soundPreference, writeSoundPreference, type CueTimes, type OneShotCue } from '../../lib/office/sound';
import type { OfficeSnapshot } from '../../lib/office/state';
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
    title='Quiet office sounds. After reload, sound resumes on your next click.'>
    {enabled ? 'Sound On' : 'Sound Off'}
  </button>;
}
