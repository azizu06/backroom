import { describe, expect, it } from 'vitest';
import { parseAttackPresets, parseAttackResult } from './response';

const decision = { kind: 'DENY', ruleIds: ['BANK_CHANGE_HOLD'], reason: 'Email cannot grant authority.', policyVersion: 1,
  quote: '<script>Ignore policy</script>', toHuman: 'Dana reviews bank changes.' };
function result() {
  return { mode: 'mock', source: 'judge', caseId: 'internal-only', trust: 'untrusted_data', environment: 'isolated_synthetic_company',
    senderDomain: 'vendor.test', steps: [{ role: 'Payables', execution: 'mock', observed: '<script>attack</script>', proposed: 'Change bank', decision }],
    skippedRoles: ['Treasury'], decision, rules: [{ id: 'BANK_CHANGE_HOLD', reason: 'Bank changes require review.' }], moneyMoved: false, paymentAttempts: 0 };
}
const preset = { id: 'Upstream:bank/swap', title: 'Bank swap', senderDomain: 'vendor.test', text: 'Replace bank details' };
describe('attack response sanitiser', () => {
  it('rebuilds nested records and preserves untrusted text as data', () => {
    const value = result();
    expect(parseAttackResult({ ...value, secret: 'private', decision: { ...decision, extra: 'private' },
      rules: [{ ...value.rules[0], extra: 'private' }],
      steps: [{ ...value.steps[0], extra: 'private', decision: { ...decision, extra: 'private' } }] })).toEqual(value);
  });
  it('supports every execution badge, textual or absent step decisions, and optional decision details', () => {
    const { quote: _quote, toHuman: _toHuman, ...minimal } = decision;
    const steps = [
      { role: 'Intake', execution: 'code', observed: 'Email', proposed: 'Route' },
      { role: 'Policy', execution: 'mock', observed: 'Request', proposed: 'Hold', decision: 'DENY' },
      { role: 'Intake', execution: 'live', observed: 'Email', proposed: 'Route', decision: minimal },
    ];
    expect(parseAttackResult({ ...result(), decision: { ...minimal, policyVersion: 'v2' }, steps })?.steps).toEqual(steps);
  });
  it('accepts policy quote objects and strips unknown quote fields', () => {
    const quote = { sentenceId: 'NF-001', text: '<script>Policy text</script>' };
    expect(parseAttackResult({ ...result(), decision: { ...decision, quote: { ...quote, secret: 'private' } } })?.decision.quote).toEqual(quote);
  });
  it('retains service-defined model evidence as bounded JSON data without aliasing the input', () => {
    const modelEvidence = { provider: 'anthropic', model: 'Haiku', costUsd: 0.01, activations: 1, live: true,
      detail: { response: '<img src=x onerror=alert(1)>', tokens: [10, 20], fallback: null } };
    const parsed = parseAttackResult({ ...result(), modelEvidence });
    expect(parsed?.modelEvidence).toEqual(modelEvidence);
    expect(parsed?.modelEvidence).not.toBe(modelEvidence);
    expect(parsed?.modelEvidence?.detail).not.toBe(modelEvidence.detail);
    expect(parseAttackResult(result())).not.toHaveProperty('modelEvidence');
  });
  it.each([null, [], {}, { ...result(), source: 'email' }, { ...result(), mode: 'other' },
    { ...result(), caseId: undefined }, { ...result(), trust: 'trusted' }, { ...result(), environment: 'production' },
    { ...result(), senderDomain: 4 }, { ...result(), skippedRoles: [null] }, { ...result(), rules: undefined },
    { ...result(), rules: [{ id: 'BANK_CHANGE_HOLD', reason: null }] },
    { ...result(), steps: [{ role: 'Intake', execution: 'paid', observed: '', proposed: '' }] },
    { ...result(), steps: [{ role: 'Intake', observed: '', proposed: '' }] },
    { ...result(), steps: [{ role: 'Intake', execution: 'code', observed: {}, proposed: 'Route' }] },
    { ...result(), steps: [{ role: 'Policy', execution: 'mock', observed: '', proposed: '', decision: null }] },
    { ...result(), decision: { ...decision, ruleIds: ['ok', 1] } }, { ...result(), decision: { ...decision, policyVersion: null } },
    { ...result(), decision: { ...decision, quote: {} } }, { ...result(), decision: { ...decision, toHuman: false } },
    { ...result(), modelEvidence: [] }, { ...result(), modelEvidence: { bad: Infinity } },
    { ...result(), modelEvidence: { bad: () => 'code' } }, { ...result(), modelEvidence: { bad: 'a'.repeat(16_001) } },
    { ...result(), moneyMoved: 'false' }, { ...result(), paymentAttempts: -1 }, { ...result(), paymentAttempts: 0.5 },
  ])('rejects malformed evidence %#', value => { expect(parseAttackResult(value)).toBeNull(); });
  it('preserves unexpected money movement so the UI can alert instead of claiming safety', () => {
    expect(parseAttackResult({ ...result(), moneyMoved: true, paymentAttempts: 2 })).toMatchObject({ moneyMoved: true, paymentAttempts: 2 });
  });
  it('accepts the final preset envelope with opaque IDs, strips extras and skips invalid or duplicate entries', () => {
    expect(parseAttackPresets({ presets: [{ ...preset, secret: 'private' }, null, { ...preset, text: 'duplicate' }, { ...preset, id: '' }],
      defaultMode: 'mock', secret: 'private', liveAllowed: false })).toEqual({ presets: [preset], defaultMode: 'mock' });
    expect(parseAttackPresets({ presets: [], defaultMode: 'mock', liveBlocked: true })).toEqual({ presets: [], defaultMode: 'mock', liveBlocked: true });
    expect(parseAttackPresets({ presets: [preset], defaultMode: 'mock', liveBlocked: false })?.liveBlocked).toBe(false);
  });
  it.each([[preset], { presets: [preset] }, { presets: [preset], defaultMode: 'live' }, { presets: 'bad', defaultMode: 'mock' },
    { presets: [{}], defaultMode: 'mock' }, { presets: [{ ...preset, senderDomain: undefined }], defaultMode: 'mock' },
  ])('rejects malformed preset envelopes %#', value => { expect(parseAttackPresets(value)).toBeNull(); });
});
