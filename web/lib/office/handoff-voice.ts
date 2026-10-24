/**
 * Optional handoff voices (#133). Browser-safe: only the HandoffRole *type* comes from the orchestrator;
 * audio is fetched through the same-origin `/api/handoff` proxy, which adds the gateway secret server-side.
 * Sound is off until the viewer turns it on, and any failure falls back to silent visuals.
 */
import type { HandoffLine } from '@backroom/orchestrator/handoff-client';
import type { HandoffAgentId } from './handoffs';
import type { HandoffPlan } from './handoff-plan';

export type HandoffRole = HandoffLine['role'];
/** Mirrors orchestrator/src/voice/voices.ts (server-only); the type check keeps the names in step. */
export const HANDOFF_ROLES = ['intake_sorter', 'extractor', 'vendor_verifier', 'payables', 'collections_caller', 'reconciler', 'auditor'] as const satisfies readonly HandoffRole[];
const ROLE_OF: Partial<Record<HandoffAgentId, HandoffRole>> = {
  intake: 'intake_sorter', extractor: 'extractor', vendor_verifier: 'vendor_verifier', payables: 'payables',
  collections: 'collections_caller', reconciler: 'reconciler', auditor: 'auditor',
};
export const MAX_LINE = 240;

export function isHandoffRole(value: unknown): value is HandoffRole {
  return typeof value === 'string' && (HANDOFF_ROLES as readonly string[]).includes(value);
}
/** Same rules the voice server enforces: non-empty, ≤240 characters, no control characters, no angle brackets. */
export function validLineText(text: unknown): text is string {
  return typeof text === 'string' && !!text.trim() && Array.from(text).length <= MAX_LINE && !/[\x00-\x1f\x7f<>]/.test(text);
}
/** A speakable line for an agent, or null (Dana and unknown agents have no voice). */
export function handoffVoiceLine(actor: string, text: string): HandoffLine | null {
  const role = ROLE_OF[actor as HandoffAgentId];
  if (!role) return null;
  const clean = Array.from(text.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/[<>]/g, '').replace(/^✕\s*/, '').trim()).slice(0, MAX_LINE).join('').trim();
  return validLineText(clean) ? { role, text: clean } : null;
}

export interface VoiceCue { readonly key: string; readonly at: number; readonly line: HandoffLine }
/** Spoken cues for a plan: each agent bubble (delivery summary or failed-check reason) at its start time. */
export function voiceCues(plan: HandoffPlan): VoiceCue[] {
  const cues: VoiceCue[] = [];
  for (const bubble of plan.bubbles) {
    const line = handoffVoiceLine(bubble.actor, bubble.text);
    if (line) cues.push({ key: `${bubble.handoffId}:${bubble.tone}:${bubble.actor}`, at: bubble.start, line });
  }
  return cues.sort((a, b) => a.at - b.at);
}

export type FetchAudio = (line: HandoffLine) => Promise<Blob>;
/** Plays a clip; must settle when `signal` aborts (sound turned off or the office unmounted). */
export type PlayAudio = (audio: Blob, signal: AbortSignal) => Promise<void>;
/**
 * Statuses that mean the voice service is unusable for this visit (not configured, rejected, too large).
 * 429 (busy) and 502/504 (slow or unreachable synthesis) only drop that line.
 */
const FATAL = /HANDOFF_AUDIO_HTTP_(400|401|403|404|405|413|415|500|503)$/;

/**
 * Plays cues one at a time while enabled. Errors never surface: a fatal status or a blocked playback
 * silences voices for the visit; a transient one just drops the line.
 */
export class HandoffVoice {
  private readonly spoken = new Set<string>();
  private queue: VoiceCue[] = [];
  private playing = false;
  private current: AbortController | null = null;
  enabled = false;
  failed = false;
  constructor(private readonly fetchAudio: FetchAudio, private readonly play: PlayAudio, private readonly onChange: () => void = () => {}) {}

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) { this.queue = []; this.current?.abort(); }
    this.onChange();
  }
  /** Marks a cue as already handled (e.g. it started before sound was turned on). */
  skip(key: string) { this.spoken.add(key); }
  say(cue: VoiceCue) {
    if (!this.enabled || this.failed || this.spoken.has(cue.key)) return;
    this.spoken.add(cue.key);
    // Keep the queue short so voices never trail far behind the visuals.
    this.queue = [...this.queue, cue].slice(-2);
    void this.drain();
  }
  private async drain() {
    if (this.playing) return;
    this.playing = true;
    try {
      while (this.queue.length && this.enabled && !this.failed) {
        const cue = this.queue.shift()!;
        const controller = new AbortController();
        this.current = controller;
        try {
          const audio = await this.fetchAudio(cue.line);
          // Sound may have been turned off while the line was synthesizing.
          if (!this.enabled || controller.signal.aborted) continue;
          await this.play(audio, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) continue;
          const message = error instanceof Error ? error.message : String(error);
          const transient = /HANDOFF_AUDIO_HTTP_\d+$/.test(message) && !FATAL.test(message);
          if (!transient) { this.failed = true; this.queue = []; this.onChange(); }
        } finally {
          if (this.current === controller) this.current = null;
        }
      }
    } finally {
      this.playing = false;
    }
  }
}

// A valid zero-length WAV, played inside the click that enables sound so later clips may autoplay (iOS Safari).
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
/**
 * One reused <audio> element. `unlock` must run inside the user's click; `play` resolves when a clip ends
 * or is aborted, and rejects if the browser refuses playback.
 */
export function createAudioPlayer() {
  let element: HTMLAudioElement | null = null;
  const get = () => (element ??= new Audio());
  return {
    unlock() {
      const audio = get();
      audio.src = SILENT_WAV;
      audio.play().catch(() => { /* Unlock is best effort; a refused clip later falls back to silence. */ });
    },
    play(clip: Blob, signal: AbortSignal): Promise<void> {
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
        audio.play().catch(error => { cleanup(); reject(error); });
      });
    },
  };
}
