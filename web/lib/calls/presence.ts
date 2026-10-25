import type { StateStore } from '@backroom/orchestrator';
import { MAX_CALL_MS } from './projection';

/** The one live voice agent row the office draws (`agent` table). */
export const VOICE_AGENT = 'voice:collections';
const PULSE_MS = 5_000;

/** Office presence for the live voice agent: on_call from registration until its call ends, idle after.
 * The engine reaps a row whose heartbeat is older than 15s, so a pulse keeps it online through quiet
 * stretches of a call; gateway tool calls refresh it too. Process-local timers, capped at MAX_CALL_MS. */
export function createVoicePresence(store: () => Pick<StateStore, 'setCallPresence'>,
  options: { pulseMs?: number; maxMs?: number; now?: () => number } = {}) {
  const now = options.now ?? Date.now;
  const live = new Map<string, ReturnType<typeof setInterval>>();
  const mark = (on: boolean) => store().setCallPresence(VOICE_AGENT, 'collections', on, now());
  const presence = {
    async start(callId: string) {
      clearInterval(live.get(callId));
      const until = now() + (options.maxMs ?? MAX_CALL_MS);
      const timer = setInterval(() => {
        if (now() >= until) void presence.end(callId).catch(error => console.error('voice presence end failed', error));
        else void mark(true).catch(error => console.error('voice presence pulse failed', error));
      }, options.pulseMs ?? PULSE_MS);
      timer.unref?.();
      live.set(callId, timer);
      await mark(true);
    },
    /** Idle only once no registered call is still live. Unknown or repeated ends are no-ops. */
    async end(callId: string) {
      if (!live.has(callId)) return;
      clearInterval(live.get(callId));
      live.delete(callId);
      if (!live.size) await mark(false);
    },
    stop() { for (const timer of live.values()) clearInterval(timer); live.clear(); },
  };
  return presence;
}
