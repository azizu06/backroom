/** Shown on the audit page. A wrong page must not read as a wrong operator code. */
export const ORIGIN_REJECTED = 'Origin rejected';
export const CODE_REJECTED = 'Operator code rejected';

export function auditUnlockMessage(serverMessage: string, labels: { origin: string; code: string } = {
  origin: ORIGIN_REJECTED, code: CODE_REJECTED,
}): string {
  const text = serverMessage.replace(/\.$/, '');
  if (text === ORIGIN_REJECTED) return labels.origin;
  if (text === CODE_REJECTED) return labels.code;
  return serverMessage;
}
