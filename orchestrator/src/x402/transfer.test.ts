import { beforeEach, expect, it, vi } from 'vitest';
import { encodeEventTopics, encodeAbiParameters } from 'viem';
import { confirmTestnetTransfer, X402_USDC } from './index';
const chain = vi.hoisted(() => ({ getChainId: vi.fn(), waitForTransactionReceipt: vi.fn() }));
vi.mock('viem', async importOriginal => ({ ...await importOriginal<typeof import('viem')>(), createPublicClient: () => chain }));
const payer = '0x1111111111111111111111111111111111111111';
const payTo = '0x2222222222222222222222222222222222222222';
const nonce = `0x${'bb'.repeat(32)}` as `0x${string}`;
const transfer = { transaction: `0x${'aa'.repeat(32)}` as `0x${string}`, payer, payTo, amount: 10000n, authorizationNonce: nonce };
const abi = [{ type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'value', type: 'uint256', indexed: false }] }] as const;
const usedAbi = [{ type: 'event', name: 'AuthorizationUsed', inputs: [{ name: 'authorizer', type: 'address', indexed: true }, { name: 'nonce', type: 'bytes32', indexed: true }] }] as const;
const usedLog = { address: X402_USDC, topics: encodeEventTopics({ abi: usedAbi, eventName: 'AuthorizationUsed', args: { authorizer: payer, nonce } }), data: '0x' };
const log = { address: X402_USDC, topics: encodeEventTopics({ abi, eventName: 'Transfer', args: { from: payer, to: payTo } }), data: encodeAbiParameters([{ type: 'uint256' }], [10000n]) };
beforeEach(() => { chain.getChainId.mockResolvedValue(84532); chain.waitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: [log, usedLog] }); });
it('confirms the exact test-USDC transfer', async () => { await expect(confirmTestnetTransfer(transfer)).resolves.toBeUndefined(); });
it.each([
  ['recipient', { payTo: payer }], ['amount', { amount: 10001n }], ['payer', { payer: payTo }],
])('rejects the wrong %s on a successful receipt', async (_name, patch) => { await expect(confirmTestnetTransfer({ ...transfer, ...patch })).rejects.toThrow('X402_TRANSFER_UNCONFIRMED'); });
it('refuses an RPC answering as mainnet', async () => { chain.getChainId.mockResolvedValue(8453); await expect(confirmTestnetTransfer(transfer)).rejects.toThrow('X402_WRONG_RPC_CHAIN'); });
it('refuses a reverted transaction', async () => { chain.waitForTransactionReceipt.mockResolvedValue({ status: 'reverted', logs: [log] }); await expect(confirmTestnetTransfer(transfer)).rejects.toThrow('X402_TRANSFER_UNCONFIRMED'); });
it('refuses an event emitted by a different token', async () => { chain.waitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: [{ ...log, address: payer }] }); await expect(confirmTestnetTransfer(transfer)).rejects.toThrow('X402_TRANSFER_UNCONFIRMED'); });

it('refuses an unrelated old transfer with no matching authorization nonce', async () => { chain.waitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: [log] }); await expect(confirmTestnetTransfer(transfer)).rejects.toThrow('X402_TRANSFER_UNCONFIRMED'); });
