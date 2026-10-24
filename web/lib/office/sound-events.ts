import { SOUND_CUES, type OneShotCue } from './sound';

export const OFFICE_SOUND_EVENT = 'office-sound-cue';

export function isOfficeCue(kind: unknown): kind is OneShotCue {
  return typeof kind === 'string' && kind !== 'roomTone' && Object.hasOwn(SOUND_CUES, kind);
}

/** Optional view effect; callers need no audio engine or WebGL imports. */
export function playOfficeCue(kind: OneShotCue): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(OFFICE_SOUND_EVENT, { detail: kind }));
}
