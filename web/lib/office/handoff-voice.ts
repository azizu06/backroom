/**
 * Optional handoff voices (#133). Browser-safe: only the HandoffRole *type* comes from the orchestrator;
 * audio is fetched through the same-origin `/api/handoff` proxy, which adds the gateway secret server-side.
 * Sound defaults on after the first user gesture; a failed line never disables later voices.
 */
import type { HandoffLine } from '@backroom/orchestrator/handoff-client';

import type { HandoffPlan } from './handoff-plan';
import type { Handoff } from './handoffs';

export type HandoffRole = HandoffLine['role'];
/** Mirrors orchestrator/src/voice/voices.ts (server-only); the type check keeps the names in step. */
export const VOICE_ROLES = ['intake_sorter', 'extractor', 'vendor_verifier', 'payables', 'collections_caller', 'reconciler', 'auditor'] as const satisfies readonly HandoffRole[];

export const MAX_LINE = 240;

export function isHandoffRole(value: unknown): value is HandoffRole {
  return typeof value === 'string' && (VOICE_ROLES as readonly string[]).includes(value);
}
/** Same rules the voice server enforces: non-empty, ≤240 characters, no control characters, no angle brackets. */
export function validLineText(text: unknown): text is string {
  return typeof text === 'string' && !!text.trim() && Array.from(text).length <= MAX_LINE && !/[\x00-\x1f\x7f<>]/.test(text);
}
/** Uses the projection's voice role and Cartesia-safe line verbatim; never synthesizes a fallback. */
export function handoffVoiceLine(role: string, text: string): HandoffLine | null {
  return isHandoffRole(role) && validLineText(text) ? { role, text } : null;
}
export interface VoiceCue { readonly key: string; readonly at: number; readonly line: HandoffLine }
/** The author speaks while offering the folder. Historical terminal rows have no cue. */
export function voiceCues(plan: HandoffPlan): VoiceCue[] {
  return plan.trips.flatMap(trip => {
    if (trip.handoff.status !== 'offered') return [];
    const line = handoffVoiceLine(trip.handoff.fromVoiceRole, trip.handoff.line);
    return line && Number.isFinite(trip.start) ? [{ key: trip.handoff.handoffId, at: trip.start, line }] : [];
  }).sort((a, b) => a.at - b.at);
}

/** New live rows speak on publication, even when subscription updates coalesce their statuses.
 * Desk choreography can queue trips indefinitely; it must not gate live audio. The mount time
 * excludes history on reload, and HandoffVoice deduplicates later updates by handoff id.
 */
export function liveVoiceCues(rows: readonly Handoff[], since: number): VoiceCue[] {
  return rows.flatMap(row => {
    const line = handoffVoiceLine(row.fromVoiceRole, row.line);
    return line && Number.isFinite(row.createdAt) && row.createdAt >= since
      ? [{ key: row.handoffId, at: row.createdAt, line }] : [];
  }).sort((a, b) => a.at - b.at);
}

export type FetchAudio = (line: HandoffLine) => Promise<Blob>;
/** Plays a clip; must settle when `signal` aborts (sound turned off or the office unmounted). */
export type PlayAudio = (audio: Blob, signal: AbortSignal) => Promise<void>;
/** Plays cues one at a time while enabled. Every failure drops only that line. */
export class HandoffVoice {
  private readonly spoken = new Set<string>();
  private queue: VoiceCue[] = [];
  private playing = false;
  private current: AbortController | null = null;
  enabled = true;
  constructor(private readonly fetchAudio: FetchAudio, private readonly play: PlayAudio, private readonly onChange: () => void = () => {}) {}

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stop();
    this.onChange();
  }
  /** Stop pending audio without changing the viewer’s preference (also safe on effect cleanup). */
  stop() { this.queue = []; this.current?.abort(); }
  /** Marks a cue as already handled (e.g. it started before sound was turned on). */
  skip(key: string) { this.spoken.add(key); }
  say(cue: VoiceCue) {
    if (!this.enabled || this.spoken.has(cue.key)) return;
    this.spoken.add(cue.key);
    // Keep the queue short so voices never trail far behind the visuals.
    this.queue = [...this.queue, cue].slice(-2);
    void this.drain();
  }
  private async drain() {
    if (this.playing) return;
    this.playing = true;
    try {
      while (this.queue.length && this.enabled) {
        const cue = this.queue.shift()!;
        const controller = new AbortController();
        this.current = controller;
        try {
          const audio = await this.fetchAudio(cue.line);
          // Sound may have been turned off while the line was synthesizing.
          if (!this.enabled || controller.signal.aborted) continue;
          await this.play(audio, controller.signal);
        } catch {
          // HTTP failures, timeouts and playback refusals apply only to this cue.
          // The next gesture can re-arm the player; later cues remain eligible.
        } finally {
          if (this.current === controller) this.current = null;
        }
      }
    } finally {
      this.playing = false;
    }
  }
}

/** Keep gestures armed so a playback refusal can recover on the next click or key. */
export function unlockOnGesture(target: EventTarget, unlock: () => void) {
  const cleanup = () => {
    target.removeEventListener('pointerdown', gesture, { capture: true });
    target.removeEventListener('keydown', gesture, { capture: true });
  };
  const gesture = () => { unlock(); };
  target.addEventListener('pointerdown', gesture, { capture: true });
  target.addEventListener('keydown', gesture, { capture: true });
  return cleanup;
}

// A valid zero-length WAV, played inside a user gesture so later clips may autoplay (iOS Safari).
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
/**
 * One reused <audio> element. `unlock` must run inside the user's click; `play` resolves when a clip ends
 * or is aborted, and rejects if the browser refuses playback.
 */
export function createAudioPlayer() {
  let element: HTMLAudioElement | null = null;
  let unlocked = false;
  const get = () => (element ??= new Audio());
  return {
    unlock() {
      if (unlocked) return;
      unlocked = true;
      const audio = get();
      audio.src = SILENT_WAV;
      audio.play().catch(() => {
        // An interrupted primer must not re-lock a real clip that replaced it.
        if (audio.src === SILENT_WAV) unlocked = false;
      });
    },
    play(clip: Blob, signal: AbortSignal): Promise<void> {
      if (!unlocked || signal.aborted) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const audio = get();
        const url = URL.createObjectURL(clip);
        const cleanup = () => {
          audio.removeEventListener('ended', ended);
          audio.removeEventListener('error', failed);
          signal.removeEventListener('abort', aborted);
          URL.revokeObjectURL(url);
        };
        const ended = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error('HANDOFF_AUDIO_PLAYBACK')); };
        const aborted = () => { audio.pause(); cleanup(); resolve(); };
        audio.addEventListener('ended', ended);
        audio.addEventListener('error', failed);
        signal.addEventListener('abort', aborted);
        audio.src = url;
        audio.play().catch(error => {
          if (error instanceof Error && error.name === 'NotAllowedError') unlocked = false;
          cleanup(); reject(error);
        });
      });
    },
  };
}
