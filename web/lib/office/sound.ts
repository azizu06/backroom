import type { OfficeSnapshot } from './state';

export const SOUND_CUES = {
  roomTone: { oscillator: 'sine', frequencies: [110, 111.7], attackMs: 900, releaseMs: 900, gain: 10 ** (-38 / 20) },
  handoff: { oscillator: 'sine', frequencies: [440, 660], attackMs: 18, releaseMs: 180, gain: 0.08 },
  deny: { oscillator: 'triangle', frequencies: [220, 165], attackMs: 8, releaseMs: 260, gain: 0.1 },
  passkey: { oscillator: 'sine', frequencies: [523.25, 783.99], attackMs: 12, releaseMs: 210, gain: 0.08 },
  interact: { oscillator: 'sine', frequencies: [392, 587.33], attackMs: 8, releaseMs: 110, gain: 0.06 },
  step: { oscillator: 'sine', frequencies: [95, 82], attackMs: 4, releaseMs: 70, gain: 0.025 },
  pingHit: { oscillator: 'triangle', frequencies: [720, 480], attackMs: 2, releaseMs: 45, gain: 0.04 },
  pingBounce: { oscillator: 'sine', frequencies: [420, 280], attackMs: 2, releaseMs: 35, gain: 0.03 },
} as const;

export type SoundCue = keyof typeof SOUND_CUES;
export type OneShotCue = Exclude<SoundCue, 'roomTone'>;
export type CueTimes = Partial<Record<OneShotCue, number>>;
export const SOUND_PREFERENCE_KEY = 'office.sound';
export const SOUND_COOLDOWN_MS = 800;
/** Short physical cues may repeat within a second; notifications keep the default cooldown. */
export const CUE_COOLDOWN_MS: Partial<Record<OneShotCue, number>> = { step: 60, pingHit: 40, pingBounce: 40 };
export function cooldownFor(kind: OneShotCue): number { return CUE_COOLDOWN_MS[kind] ?? SOUND_COOLDOWN_MS; }

export function soundPreference(storage?: Pick<Storage, 'getItem'>): 'on' | 'off' {
  try { return (storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage))?.getItem(SOUND_PREFERENCE_KEY) === 'on' ? 'on' : 'off'; }
  catch { return 'off'; }
}

export function writeSoundPreference(value: 'on' | 'off', storage?: Pick<Storage, 'setItem'>): void {
  try { (storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage))?.setItem(SOUND_PREFERENCE_KEY, value); }
  catch { /* Storage can be unavailable in private or embedded contexts. */ }
}

/** Pure diff: the caller supplies its clock and records only cues actually played. */
export function cuesFor(prev: OfficeSnapshot, next: OfficeSnapshot, now = 0, lastPlayed: Readonly<CueTimes> = {}): OneShotCue[] {
  const cues: OneShotCue[] = [];
  const auditIds = new Set(prev.audit.map(row => row.id));
  const denialIds = new Set(prev.denials.map(row => row.auditId));
  const agents = new Map(prev.agents.map(agent => [agent.id, agent]));
  const newDeny = next.audit.some(row => row.decision === 'DENY' && !auditIds.has(row.id));
  const newDenial = next.denials.some(row => !denialIds.has(row.auditId));
  if (newDeny || newDenial) cues.push('deny');
  if (next.audit.some(row => row.decision === 'ESCALATE' && !auditIds.has(row.id)) ||
    next.agents.some(agent => !!agent.escalationId && agent.escalationId !== agents.get(agent.id)?.escalationId)) cues.push('passkey');
  return cues.filter(kind => now - (lastPlayed[kind] ?? -Infinity) >= cooldownFor(kind)).slice(0, 3);
}
