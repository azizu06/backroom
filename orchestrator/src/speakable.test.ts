import { describe, expect, it } from 'vitest';
import answerKey from '../../fixtures/why/answer-key.json';
import { speakable } from './speakable';
import { POLICY_SENTENCES } from '@backroom/policy';

describe('speakable presentation text', () => {
  it('explains the bank-change fixture without changing its citation', () => {
    expect(speakable(answerKey[1]!.modelAnswer)).toBe(
      'The changed bank details and lookalike sender triggered a bank change requiring human approval and a sender domain that resembles the vendor’s [entry:214].');
  });

  it.each([
    ['INV-4482 and CASE-4471; account ••1234', 'invoice 4482 and case 4471; account ending in 1234'],
    ['requested_installments and maxInstallments; BANK_CHANGE_HOLD', 'requested installments and max installments; a bank change requiring human approval'],
    ['ruleIds and pending_owner with UNKNOWN_RULE', 'rule ids and pending owner with unknown rule'],
    ['Amounts $1,234.56 and 37; four installments, limit two.', 'Amounts $1,234.56 and 37; four installments, limit two.'],
    ['Held [entry:audit:CASE-4471_MAX_INSTALLMENTS].', 'Held [entry:audit:CASE-4471_MAX_INSTALLMENTS].'],
    ['CONSENT_REQUIRED', POLICY_SENTENCES['NF-003'].replace(/\.$/, '')],
    ['Retry HTTP 409 NF-019 case-1:a2 0d5955b2-6d5b-4123-884d-abcdef123456', 'Retry'],
  ])('makes %s speakable', (input, expected) => {
    expect(speakable(input)).toBe(expected);
    expect(speakable(speakable(input))).toBe(expected);
  });
});
