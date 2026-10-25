import { generatePrivateKey } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';
import { MemoryStateStore } from '../store';
import { runX402Console, x402TestnetAvailability } from './console';

describe('operator console x402 runs', () => {
  it('pays a simulated invoice through the real 402 handshake and records labelled audits', async () => {
    const state = new MemoryStateStore();
    const key = generatePrivateKey();
    const result = await runX402Console('simulated', state, { simulatedKey: () => key });
    expect(result).toMatchObject({ rail: 'x402 simulated', status: 'paid', amount: '$1,250.00', policy: { decision: 'ALLOW' },
      proof: { vendorRequests: 2, signatures: 1 }, transaction: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
    expect(result.explorer).toBeUndefined();
    const audit = await state.listAudit();
    expect(audit.map(row => row.action)).toEqual(expect.arrayContaining(['pay_invoice', 'x402_simulated_policy', 'x402_simulated_settlement', 'x402_simulated_completed']));
    expect(audit.every(row => row.inputs?.paymentRail === 'x402 simulated')).toBe(true);
    expect(audit.some(row => /testnet/.test(row.action))).toBe(false);
    expect(result.paymentAuditHref).toBe(`/audit?entry=${encodeURIComponent(audit.find(row => row.action === 'x402_simulated_completed')!.id)}`);
    expect((await state.verifyAuditChain()).valid).toBe(true);
    expect(JSON.stringify(result)).not.toContain(key.slice(2));
  });

  it('holds the over-limit invoice with zero vendor requests or signatures', async () => {
    const state = new MemoryStateStore();
    const result = await runX402Console('blocked', state);
    expect(result).toMatchObject({ rail: 'x402 simulated', status: 'held', amount: '$2,450.00',
      policy: { decision: 'ESCALATE', ruleIds: ['OVER_LIMIT'] }, proof: { vendorRequests: 0, signatures: 0 } });
    expect(result.transaction).toBeUndefined();
    expect(result).not.toHaveProperty('failed');
    expect((await state.listAudit()).some(row => row.action === 'pay_invoice' && row.decision === 'ESCALATE')).toBe(true);
  });

  it('refuses testnet without the host opt-in and never touches Keychain', async () => {
    const keyPresent = vi.fn(() => true);
    expect(x402TestnetAvailability({}, 'darwin', keyPresent)).toMatchObject({ available: false, reason: expect.stringContaining('X402_LIVE=1') });
    expect(x402TestnetAvailability({ X402_LIVE: '1' }, 'linux', keyPresent)).toMatchObject({ available: false, reason: expect.stringContaining('macOS') });
    expect(keyPresent).not.toHaveBeenCalled();
    const state = new MemoryStateStore();
    expect(await runX402Console('testnet', state, { env: {}, keyPresent })).toMatchObject({ rail: 'x402 testnet', status: 'unavailable', failed: true });
    expect(await state.listAudit()).toEqual([]);
    expect(x402TestnetAvailability({ X402_LIVE: '1' }, 'darwin', () => false).reason).toContain('x402:wallet');
    expect(x402TestnetAvailability({ X402_LIVE: '1' }, 'darwin', () => true, () => true)).toEqual({ available: true });
    expect(x402TestnetAvailability({ X402_LIVE: '1' }, 'darwin', () => true, () => false)).toMatchObject({ available: false, reason: expect.stringContaining('UNAVAILABLE') });
    expect(x402TestnetAvailability({ X402_LIVE: '1', X402_ALLOW_DIRECT_KEY: '1' }, 'darwin', () => true, () => false)).toEqual({ available: true });
  });
});

it('publishes the session receipt and replays it without touching the signer', async () => {
  const root = globalThis as typeof globalThis & { backroomX402TestnetResult?: Awaited<ReturnType<typeof runX402Console>> };
  const receipt = { rail: 'x402 testnet' as const, scenario: 'testnet' as const, status: 'paid' as const,
    transaction: '0x123', explorer: 'https://sepolia.basescan.org/tx/0x123' };
  root.backroomX402TestnetResult = receipt;
  try {
    const keyPresent = vi.fn(() => false);
    expect(x402TestnetAvailability({}, 'linux', keyPresent)).toMatchObject({ available: false, reason: 'Already paid this session', lastResult: receipt });
    expect(await runX402Console('testnet', new MemoryStateStore(), { env: {}, keyPresent })).toEqual({ ...receipt, replay: true });
    expect(keyPresent).not.toHaveBeenCalled();
  } finally { delete root.backroomX402TestnetResult; }
});
