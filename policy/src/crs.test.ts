import { expect, it } from 'vitest';
import { evaluate } from './index';
it.each(['vendor_onboarding', 'payables'] as const)('CRS risk 88 holds %s with a policy quote', badge => {
  const result = evaluate(badge, badge === 'payables' ? { type: 'pay_invoice' } : { type: 'propose_bank_change', emailDomain: 'vendor.example' },
    { vendor: { id: 'v', knownDomain: 'vendor.example', approved: true, inMaster: true, pendingBankChange: true }, signals: { fraudRiskScore: 88 } });
  expect(result).toMatchObject({ kind: 'ESCALATE', ruleIds: ['FRAUD_RISK_HOLD'], quote: { sentenceId: 'NF-028' } });
});
it.each([[69, 'BANK_CHANGE_HOLD'], [70, 'FRAUD_RISK_HOLD'], [101, 'INVALID_INPUT'], [NaN, 'INVALID_INPUT']] as const)('risk %s uses %s at the policy boundary', (score, rule) => {
  expect(evaluate('vendor_onboarding', { type: 'propose_bank_change', emailDomain: 'vendor.example' }, {
    vendor: { id: 'v', knownDomain: 'vendor.example', inMaster: true, approved: true, pendingBankChange: true }, signals: { fraudRiskScore: score },
  }).ruleIds).toEqual([rule]);
});
