import { createMockCallFeed } from './calls-mock';

export type CallStatus = 'idle' | 'ringing' | 'live' | 'ended';
export type CallDirection = 'inbound' | 'outbound';
export interface TranscriptLine { id: string; speaker: 'agent' | 'caller'; agentId?: string; text: string; at: number }
export interface CallState {
  status: CallStatus; callId?: string; direction?: CallDirection; line: 'collections'; agentId?: string; agentName?: string;
  callerLabel?: string; speakingAgentId?: string; transcript: readonly TranscriptLine[]; startedAt?: number; endedAt?: number; endReason?: string;
}
export const IDLE_CALL: CallState = { status: 'idle', line: 'collections', transcript: [] };
export type CallEvent =
  | { type: 'ring'; callId: string; direction: CallDirection; line?: 'collections'; agentId?: string; agentName?: string; callerLabel?: string; at?: number }
  | { type: 'answer'; callId: string; at?: number }
  | { type: 'line'; callId: string; line: TranscriptLine }
  | { type: 'end'; callId: string; reason?: string; at?: number }
  | { type: 'clear' }
  | { type: 'snapshot'; state: CallState };

export function callReducer(state: CallState, event: CallEvent): CallState {
  if (event.type === 'snapshot') return event.state;
  if (event.type === 'clear') return state.status === 'ended' ? IDLE_CALL : state;
  if (event.type === 'ring') {
    if (state.status !== 'idle' && state.status !== 'ended') return state;
    return { status: 'ringing', callId: event.callId, direction: event.direction, line: 'collections', agentId: event.agentId,
      agentName: event.agentName, callerLabel: event.callerLabel, transcript: [], startedAt: event.at };
  }
  if (!state.callId || event.callId !== state.callId) return state;
  if (event.type === 'answer') return state.status === 'ringing' ? { ...state, status: 'live', startedAt: event.at ?? state.startedAt } : state;
  if (event.type === 'line') {
    if (state.status !== 'live' || state.transcript.some(line => line.id === event.line.id)) return state;
    const transcript = [...state.transcript, event.line].slice(-50);
    return { ...state, transcript, ...(event.line.speaker === 'agent' ? { speakingAgentId: event.line.agentId ?? state.agentId } : {}) };
  }
  if (event.type === 'end') return state.status === 'ringing' || state.status === 'live'
    ? { ...state, status: 'ended', endedAt: event.at, endReason: event.reason } : state;
  return state;
}

// MAP AZIZ'S OWN CALL PROJECTION TABLE HERE (separate from agent_handoff; calls are not built yet).
// Its provisional row shape is { callId, status, direction, line, agentId, agentName, callerLabel,
// transcript: [{ id, speaker, agentId, text, at }], startedAt, endedAt, endReason }.
// This is the one place that maps a backend row into the phone's display state.
export function callFromProjection(row: unknown): CallState | null {
  if (!row || typeof row !== 'object') return null;
  const value = row as Record<string, unknown>;
  const string = (v: unknown) => typeof v === 'string' ? v : undefined;
  const callId = string(value.callId ?? value.id);
  const status = value.status;
  if (!callId || !['ringing', 'live', 'ended'].includes(String(status))) return null;
  const transcript: TranscriptLine[] = Array.isArray(value.transcript) ? value.transcript.flatMap((item): TranscriptLine[] => {
    if (!item || typeof item !== 'object') return [];
    const line = item as Record<string, unknown>;
    if (typeof line.id !== 'string' || (line.speaker !== 'agent' && line.speaker !== 'caller') || typeof line.text !== 'string') return [];
    return [{ id: line.id, speaker: line.speaker, ...(typeof line.agentId === 'string' ? { agentId: line.agentId } : {}), text: line.text, at: typeof line.at === 'number' ? line.at : 0 }];
  }).slice(-50) : [];
  return { status, callId, direction: value.direction === 'outbound' ? 'outbound' : 'inbound', line: 'collections',
    ...(string(value.agentId) ? { agentId: string(value.agentId) } : {}), ...(string(value.agentName) ? { agentName: string(value.agentName) } : {}),
    ...(string(value.callerLabel) ? { callerLabel: string(value.callerLabel) } : {}), transcript,
    ...(typeof value.startedAt === 'number' ? { startedAt: value.startedAt } : {}), ...(typeof value.endedAt === 'number' ? { endedAt: value.endedAt } : {}),
    ...(string(value.endReason) ? { endReason: string(value.endReason) } : {}),
    ...(transcript.at(-1)?.speaker === 'agent' ? { speakingAgentId: transcript.at(-1)?.agentId } : {}),
  } as CallState;
}

export const CALL_DISCLOSURE = 'Calls are AI-disclosed and only go to the allowlisted demo number.';
// Aziz's host routes (web/lib/calls): the operator-session request and the read-only live feed.
const CALL_REQUEST_ENDPOINT: string | null = '/api/calls/request';
const CALL_FEED_ENDPOINT = '/api/calls/active';
export const CALL_UNLOCK_PATH = '/calls';
export type CallRequestResult = { ok: boolean; reason?: 'unavailable' | 'failed' | 'locked'; message: string };
export async function requestCall(_input?: unknown): Promise<CallRequestResult> {
  if (!CALL_REQUEST_ENDPOINT) return { ok: false, reason: 'unavailable', message: 'Call requests not available yet' };
  // The scripted preview never reaches the real dial route.
  if (typeof window !== 'undefined' && isMockCalls(window.location.search)) return { ok: false, reason: 'unavailable', message: 'Mock preview: no call placed' };
  try {
    const response = await fetch(CALL_REQUEST_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ line: 'collections' }) });
    const body = await response.json() as { message?: unknown };
    return { ok: response.ok, ...(response.status === 401 ? { reason: 'locked' as const } : {}),
      message: typeof body.message === 'string' ? body.message : response.ok ? 'Call request submitted' : 'Call request unavailable' };
  } catch { return { ok: false, reason: 'failed', message: 'Call request unavailable' }; }
}
// PROVISIONAL: replace with the Play settings sound toggle
export function soundEnabled(): boolean { try { return localStorage['backroom:sound'] === 'on'; } catch { return false; } }
export function isMockCalls(search: string) { return new URLSearchParams(search).get('calls') === 'mock'; }

/** Polls the host's read-only call projection; a failed poll keeps the last snapshot. */
export function pollCallFeed(apply: (state: CallState) => void, intervalMs = 1500): () => void {
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    try {
      const response = await fetch(CALL_FEED_ENDPOINT, { cache: 'no-store' });
      const body = response.ok ? await response.json() as { call?: unknown } : undefined;
      if (body && !stopped) apply(callFromProjection(body.call) ?? IDLE_CALL);
    } catch { /* keep the last snapshot; the next poll retries */ }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}

let snapshot = IDLE_CALL;
const listeners = new Set<() => void>();
let stopFeed: (() => void) | undefined;
function notify() { listeners.forEach(listener => listener()); }
export const callStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    if (listeners.size === 1 && typeof window !== 'undefined' && isMockCalls(window.location.search)) {
      const params = new URLSearchParams(window.location.search);
      const speed = params.get('callsSpeed') === 'fast' ? 10 : params.get('callsSpeed') === 'slow' ? 0.25 : 1;
      stopFeed = createMockCallFeed(event => { snapshot = callReducer(snapshot, event); notify(); }, speed);
    } else if (listeners.size === 1 && typeof window !== 'undefined') {
      stopFeed = pollCallFeed(state => { if (JSON.stringify(state) !== JSON.stringify(snapshot)) { snapshot = state; notify(); } });
    }
    return () => { listeners.delete(listener); if (!listeners.size) { stopFeed?.(); stopFeed = undefined; snapshot = IDLE_CALL; } };
  },
  getSnapshot: () => snapshot,
  getServerSnapshot: () => IDLE_CALL,
  dispatch(event: CallEvent) { const next = callReducer(snapshot, event); if (next !== snapshot) { snapshot = next; notify(); } },
};
