import { expect, it } from 'vitest';
import { facilitatorReason } from './diagnostics';

it('retains machine codes and redacts provider prose, signatures and credentials', () => {
  expect(facilitatorReason('invalid_exact_evm_payload_signature')).toBe('invalid_exact_evm_payload_signature');
  expect(facilitatorReason('transaction_failed: raw provider detail')).toBe('transaction_failed');
  for (const value of ['Bearer secret-value', `0x${'ab'.repeat(65)}`, 'test.secret.token', 'A'.repeat(184)]) {
    expect(facilitatorReason(value)).toBe('redacted_provider_error');
  }
  expect(facilitatorReason(undefined)).toBeUndefined();
});
