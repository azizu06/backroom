const messages: Record<string, string> = {
  APPROVALS_NOT_CONFIGURED: 'Controller approvals need to be configured on the server.',
  CONTROLLER_NOT_REGISTERED: 'Set up Dana’s passkey before deciding this request.',
  CONTROLLER_ALREADY_REGISTERED: 'Dana already has a passkey. Use that passkey to review requests.',
  ENROLLMENT_UNAUTHORIZED: 'The enrollment code did not match. Check the code and try again.',
  ESCALATION_NOT_FOUND: 'This approval request could not be found. Check the link.',
  ESCALATION_CLOSED: 'This request has closed. Refresh to see its current status.',
  CHALLENGE_INVALID: 'The passkey prompt expired or was already used. Try your decision again.',
  ORIGIN_REJECTED: 'Open the approval link on the configured Backroom address.',
};

/** Carries the server error code so pages can tell a dead link from a passing outage. */
export class ApprovalError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) {
    super(message);
    this.name = 'ApprovalError';
  }
}

export async function approvalRequest(path: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  } catch {
    throw new ApprovalError('Backroom could not be reached. Check the connection and try again.', 'NETWORK');
  }
  // A proxy or crashed server can answer with HTML; never show a raw JSON parse error to Dana.
  const parsed: unknown = await response.json().catch(() => undefined);
  // Every route answers with a JSON object; anything else (HTML, null, a bare string) counts as an outage.
  const result = typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  const code = typeof result === 'object' && result !== null && typeof (result as { error?: unknown }).error === 'string'
    ? (result as { error: string }).error : undefined;
  if (!response.ok || result === undefined) {
    const known = code !== undefined && Object.prototype.hasOwnProperty.call(messages, code) ? messages[code] : undefined;
    const fallback = result === undefined
      ? `Backroom is not responding right now (HTTP ${response.status}). Try again in a moment.`
      : body === undefined ? 'This page could not be loaded. Try again in a moment.'
      : 'Your passkey could not be verified. Try again with Dana’s passkey.';
    throw new ApprovalError(known ?? fallback, code, response.status);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- callers read route-specific shapes, as before
  return result as any;
}
