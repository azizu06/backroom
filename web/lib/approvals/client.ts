export async function approvalRequest(path: string, body?: unknown) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) {
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
    throw new Error(messages[result.error] ?? 'Your passkey could not be verified. Try again with Dana’s passkey.');
  }
  return result;
}
