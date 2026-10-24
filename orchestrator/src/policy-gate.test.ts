import { describe, expect, it, vi } from 'vitest';
import { evaluate } from '@backroom/policy';
import { evaluateStep } from './policy-gate';

vi.mock('@backroom/policy', () => ({ evaluate: vi.fn(() => ({ kind: 'ALLOW', ruleIds: [], policyVersion: 3 })) }));

describe('policy/effect binding', () => {
  it('evaluates the actual payment fields rather than conflicting proposed fields', () => {
    evaluateStep('payables', { kind: 'nessie', action: { type: 'pay_invoice', amountCents: 1 },
      input: { amountCents: 5000 }, context: { policyVersion: 3 } });
    expect(evaluate).toHaveBeenLastCalledWith('payables', { type: 'pay_invoice', amountCents: 5000 }, { policyVersion: 3 });
  });
  it('denies an action that would authorize a different effect', () => {
    expect(evaluateStep('collections', { kind: 'nessie', action: { type: 'call_client' },
      input: {}, context: { policyVersion: 3 } })).toMatchObject({ kind: 'DENY', reason: 'NOT_IN_BADGE' });
  });
});
