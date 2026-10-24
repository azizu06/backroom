export interface ApprovalTerms {
  installments: number;
  firstPaymentPct: number;
  durationDays: number;
  waiveFee: boolean;
  discountPct: number;
}
export type ControllerDecision =
  | { kind: 'Approve' | 'Deny' }
  | { kind: 'Counter'; terms: ApprovalTerms };

/** Runtime parsing: neither voice text nor a claimed method/verified flag grants authority. */
export function parseControllerDecision(value: unknown): ControllerDecision {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_DECISION');
  const body = value as Record<string, unknown>;
  if ((body.kind === 'Approve' || body.kind === 'Deny') && Object.keys(body).length === 1) {
    return { kind: body.kind };
  }
  if (body.kind !== 'Counter' || Object.keys(body).length !== 2 || !body.terms || typeof body.terms !== 'object') {
    throw new Error('INVALID_DECISION');
  }
  const terms = body.terms as Record<string, unknown>;
  const number = (key: string, min: number, max: number, integer = false) => {
    const n = terms[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
      throw new Error('INVALID_DECISION');
    }
    return n;
  };
  if (Object.keys(terms).sort().join(',') !== 'discountPct,durationDays,firstPaymentPct,installments,waiveFee' ||
      typeof terms.waiveFee !== 'boolean') throw new Error('INVALID_DECISION');
  return { kind: 'Counter', terms: {
    installments: number('installments', 1, 100, true), firstPaymentPct: number('firstPaymentPct', 0, 100),
    durationDays: number('durationDays', 0, 3650, true), waiveFee: terms.waiveFee,
    discountPct: number('discountPct', 0, 100),
  } };
}
