/** Live-call controller window. Default five minutes, capped so a bad env value cannot leave a card open all day. */
export const DEFAULT_APPROVAL_WINDOW_MS = 5 * 60_000;
export const MAX_APPROVAL_WINDOW_MS = 15 * 60_000;

function envOf(source?: Record<string, string | undefined>): Record<string, string | undefined> {
  if (source) return source;
  return typeof process === 'undefined' ? {} : process.env;
}

/** Milliseconds a live-call escalation stays open. Unset, empty, or invalid values use the default. */
export function approvalWindowMs(source?: Record<string, string | undefined>): number {
  const raw = envOf(source).APPROVAL_WINDOW_MS;
  if (raw === undefined || raw.trim() === '') return DEFAULT_APPROVAL_WINDOW_MS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1_000) return DEFAULT_APPROVAL_WINDOW_MS;
  return Math.min(parsed, MAX_APPROVAL_WINDOW_MS);
}
