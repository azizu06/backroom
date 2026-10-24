const messages: Record<string, string> = {
  ORIGIN_REJECTED: 'This page does not match the configured deployment. Open the demo at its configured address.',
  JSON_REQUIRED: 'The demo needs a JSON request. Reload the page and try again.',
  BODY_TOO_LARGE: 'That submission is too large. Use at most 2,000 characters.',
  INVALID_JSON: 'The submission could not be read. Reload the page and try again.',
  INVALID_ATTACK: 'Enter email or invoice text (up to 2,000 characters), or choose a preset.',
  ATTACK_NOT_CONFIGURED: 'The attack demo service is not configured.',
  ATTACK_UNREACHABLE: 'The attack demo service is offline',
  ATTACK_TIMEOUT: 'The attack demo timed out. Try again in a moment.',
  ATTACK_BAD_RESPONSE: 'The attack demo returned an unreadable result. Try again in a moment.',
  ATTACK_RATE_LIMITED: 'Six runs are allowed per minute. Wait a minute before trying again.',
  ATTACK_REJECTED: 'The attack demo service could not run this submission. Try again in a moment.',
  NETWORK_ERROR: 'The demo could not be reached. Check your connection and try again.',
};
export function attackErrorMessage(code: unknown, status?: number): string {
  if (code === 'ATTACK_RATE_LIMITED') return messages.ATTACK_RATE_LIMITED!;
  if (code !== 'ATTACK_REJECTED' && code !== 'ATTACK_UNREACHABLE' && typeof code === 'string' && Object.hasOwn(messages, code)) return messages[code]!;
  if (status === 400) return 'Invalid request. Check the text and try again.';
  if (status === 401 || status === 503) return 'The attack demo service is not configured.';
  if (status === 403) return "Live mode isn't enabled on this server";
  if (status === 413) return 'That submission is too long. Use at most 2,000 characters.';
  if (status === 409) return 'Model calls are switched off (LLM OFF), so live mode is unavailable; mock still works.';
  if (status === 429) return 'The single live attempt for this session has been used; mock still works.';
  if (status === 502) return "The attack demo service is offline, or live mode isn't available on this machine (live needs the demo Mac).";
  if (status === 504) return messages.ATTACK_TIMEOUT!;
  return 'The attack demo could not complete the request. Try again in a moment.';
}
