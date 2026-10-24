import { randomUUID } from 'node:crypto';
import type { Context } from '@backroom/policy';
import type { DemoVoiceBridge } from './demo-bridge';

export interface AdminDialResponse { status: number; body: string | { sessionId: string; callId: string } }
export interface AdminDialOptions {
  bridge: Pick<DemoVoiceBridge, 'clientStopped' | 'preCall' | 'callEvent'>;
  /** Dials the server-configured scenario and allowlisted target only. Call `providerRequest`
   * immediately before the provider HTTP request, so a failure can be classified as unrung. */
  dial(sessionId: string, signals: Context['signals'], providerRequest: () => void): Promise<{ sessionId: string; callId: string }>;
  /** The relay's private audit, the same sink as CALL_PERMIT. */
  audit(entry: { action: string; ruleIds: string[]; reason: string; at: string }): Promise<void>;
  /** Journal view: an unknown session counts as stopped. */
  sessionStopped(sessionId: string): Promise<boolean>;
  now?: () => number; newSessionId?: () => string;
  /** A bound call holds the line until its lifecycle stops it, or this long at most. */
  maxCallMs?: number;
  /** An unconfirmed provider dial may still ring for this long. */
  ringWindowMs?: number;
}

/**
 * `/_admin/dial` behind the admin secret. One dial at a time, one call on the line, and only
 * after the demo host reports a `ready` pre-call. A blocked, missing or unreadable pre-call
 * refuses with no provider request. Never retries a dial.
 */
export function createAdminDial(options: AdminDialOptions) {
  const now = options.now ?? Date.now;
  const maxCallMs = options.maxCallMs ?? 10 * 60_000, ringWindowMs = options.ringWindowMs ?? 90_000;
  let dialing = false;
  let line: { sessionId: string; until: number } | undefined;
  const blocked = async (status: number, body: string, reason: string): Promise<AdminDialResponse> => {
    await options.audit({ action: 'CALL_BLOCKED_PRECALL', ruleIds: [], reason, at: new Date(now()).toISOString() });
    return { status, body };
  };
  return async (): Promise<AdminDialResponse> => {
    // Take the lock before any await, so two requests cannot both pass the line check.
    if (dialing) return { status: 409, body: 'DIAL_IN_PROGRESS' };
    dialing = true;
    try {
      if (line && now() < line.until && !(await options.sessionStopped(line.sessionId))) return { status: 409, body: 'CALL_ACTIVE' };
      if (await options.bridge.clientStopped()) return { status: 409, body: 'CLIENT_STOPPED' };
      let gate: Awaited<ReturnType<DemoVoiceBridge['preCall']>>;
      try { gate = await options.bridge.preCall(); } catch { return blocked(503, 'PRECALL_UNAVAILABLE', 'pre-call status unreachable'); }
      if (gate.status === 'blocked') return blocked(409, `PRECALL_BLOCKED:${gate.reason}`, gate.reason);
      if (gate.status !== 'ready') return blocked(409, `PRECALL_NOT_READY:${gate.detail}`, `pre-call ${gate.detail}`);
      const sessionId = (options.newSessionId ?? randomUUID)();
      let contacted = false;
      try {
        const result = await options.dial(sessionId, gate.signals, () => { contacted = true; });
        line = { sessionId, until: now() + maxCallMs };
        return { status: 200, body: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const rejected = /^(Cartesia HTTP 4\d\d|DIAL_REJECTED)$/.test(message);
        if (contacted && !rejected) {
          // The provider may already be ringing the phone. Hold the line; never redial.
          line = { sessionId, until: now() + ringWindowMs };
          return { status: 504, body: 'DIAL_UNCONFIRMED' };
        }
        // Registered at most; nothing rang. Release the office desk phone.
        await options.bridge.callEvent(sessionId, 'failed').catch(() => undefined);
        if (!contacted && /^[A-Z0-9_,]{1,200}$/.test(message)) return { status: 409, body: `CALL_DENIED:${message}` };
        return { status: 502, body: 'DIAL_FAILED' };
      }
    } finally { dialing = false; }
  };
}
