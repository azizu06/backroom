/** Provider lifecycle for live voice calls, pushed by the voice relay over the host's private loopback.
 * Times only: no number, transcript or amount. Process-local, shared across Next route chunks. */
export type VoiceCallEvent = 'registered' | 'started' | 'completed' | 'failed';
export interface VoiceCallLifecycle { registeredAt?: number; startedAt?: number; endedAt?: number; endReason?: 'completed' | 'failed' }

const LIMIT = 50;
const root = globalThis as typeof globalThis & { backroomVoiceLifecycle?: Map<string, VoiceCallLifecycle> };
const calls = () => root.backroomVoiceLifecycle ??= new Map();

export function recordVoiceCallEvent(sessionId: string, event: VoiceCallEvent, at = Date.now()): void {
  if (!/^[a-f0-9-]{36}$/.test(sessionId)) throw new Error('INVALID_SESSION');
  const row = calls().get(sessionId) ?? {};
  if (event === 'registered') row.registeredAt ??= at;
  else if (event === 'started') row.startedAt ??= at;
  else if (row.endedAt === undefined) { row.endedAt = at; row.endReason = event; }
  calls().delete(sessionId); calls().set(sessionId, row);
  while (calls().size > LIMIT) calls().delete(calls().keys().next().value!);
}
export const voiceCallLifecycle = (sessionId: string): VoiceCallLifecycle | undefined => {
  const row = calls().get(sessionId);
  return row && { ...row };
};
