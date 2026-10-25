import { expect, it, vi } from 'vitest';
import { runApDebit } from './ap-debit';

it('P01 pays once and reconciles the Nessie withdrawal through Dispatcher + ClaudeAgentRuntime', async () => {
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_NETWORK'));
  try {
    const run = await runApDebit();
    expect(run.match).toBe(true);
    expect(run.posts).toBe(1);
    expect(run.first.result).toMatchObject({status:'paid', reconciliation:{match:'EXACT'}});
    expect(run.repeat.result.receiptId).toBe(run.first.result.receiptId);
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});

it('keeps a mismatched debit held without calling it reconciled', async () => {
  const run = await runApDebit('mismatch');
  expect(run.match).toBe(false);
  expect(run.first.result).toMatchObject({status:'held', reconciliation:{match:'MISMATCH'}});
  expect(run.posts).toBe(1);
});
