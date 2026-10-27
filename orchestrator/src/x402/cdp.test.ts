import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  credentials: vi.fn(), present: vi.fn(), create: vi.fn(), get: vi.fn(), faucet: vi.fn(),
  balance: vi.fn(), wait: vi.fn(), chainId: vi.fn(), client: vi.fn(),
}));
vi.mock('./keychain', () => ({ cdpCredentials: mocks.credentials, cdpCredentialsPresent: mocks.present,
  testnetAccount: vi.fn(() => ({ address: '0x2222222222222222222222222222222222222222', signTypedData: vi.fn() })) }));
vi.mock('@coinbase/cdp-sdk', () => ({ CdpClient: class { constructor(options: unknown) { mocks.client(options); }
  evm = { getOrCreateAccount: mocks.create, getAccount: mocks.get, requestFaucet: mocks.faucet }; } }));
vi.mock('viem', async original => ({ ...await original<typeof import('viem')>(), createPublicClient: () => ({
  getChainId: mocks.chainId, readContract: mocks.balance, waitForTransactionReceipt: mocks.wait,
}) }));
import { cdpWalletBalance, loadTestnetWallet } from './cdp';

const address = '0x1111111111111111111111111111111111111111';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.credentials.mockReturnValue({ apiKeyId: 'test-id', apiKeySecret: 'test-secret', walletSecret: 'test-wallet-secret' });
  mocks.present.mockReturnValue(true);
  mocks.create.mockResolvedValue({ address, signTypedData: vi.fn() });
  mocks.get.mockResolvedValue({ address });
  mocks.chainId.mockResolvedValue(84532);
  mocks.balance.mockResolvedValue(60_000n);
  mocks.faucet.mockResolvedValue({ transactionHash: `0x${'ab'.repeat(32)}` });
  mocks.wait.mockResolvedValue({ status: 'success' });
});

it('loads the same named CDP account and funds only when below 0.05 Base Sepolia test USDC', async () => {
  mocks.balance.mockResolvedValueOnce(49_999n).mockResolvedValueOnce(20_049_999n);
  const wallet = await loadTestnetWallet({ X402_LIVE: '1' });
  expect(wallet).toMatchObject({ address, walletLabel: 'Coinbase CDP server wallet' });
  expect(mocks.create).toHaveBeenCalledWith({ name: 'backroom-payables' });
  expect(mocks.faucet).toHaveBeenCalledExactlyOnceWith({ address, network: 'base-sepolia', token: 'usdc' });
  expect(mocks.wait).toHaveBeenCalled();
  await loadTestnetWallet({ X402_LIVE: '1' });
  expect(mocks.faucet).toHaveBeenCalledTimes(1);
});

it('reads public balance without creating or funding an account', async () => {
  expect(await cdpWalletBalance()).toMatchObject({ status: 'AVAILABLE', address, network: 'eip155:84532', balanceAtomic: '60000', decimals: 6 });
  expect(mocks.get).toHaveBeenCalledWith({ name: 'backroom-payables' });
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.faucet).not.toHaveBeenCalled();
});

it('fails closed without host opt-in or wallet secret and only permits explicit direct fallback', async () => {
  await expect(loadTestnetWallet({})).rejects.toThrow('CDP_UNAVAILABLE_X402_LIVE_REQUIRED');
  expect(mocks.create).not.toHaveBeenCalled();
  mocks.present.mockReturnValue(false);
  await expect(loadTestnetWallet({ X402_LIVE: '1' })).rejects.toThrow('CDP_UNAVAILABLE_KEYCHAIN_CREDENTIALS');
  expect(await loadTestnetWallet({ X402_LIVE: '1', X402_ALLOW_DIRECT_KEY: '1' })).toMatchObject({ walletLabel: 'direct testnet key' });
  expect(mocks.create).not.toHaveBeenCalled();
});

it('prefers CDP even with fallback enabled and never switches wallets on a CDP error', async () => {
  expect(await loadTestnetWallet({ X402_LIVE: '1', X402_ALLOW_DIRECT_KEY: '1' })).toMatchObject({ walletLabel: 'Coinbase CDP server wallet' });
  mocks.create.mockRejectedValue(new Error('provider secret test-secret'));
  await expect(loadTestnetWallet({ X402_LIVE: '1', X402_ALLOW_DIRECT_KEY: '1' })).rejects.toThrow('CDP_UNAVAILABLE_ACCOUNT_OR_FAUCET');
  mocks.get.mockRejectedValue(new Error('provider secret test-secret'));
  expect(JSON.stringify(await cdpWalletBalance())).not.toContain('test-secret');
  expect(await cdpWalletBalance()).toMatchObject({ status: 'UNAVAILABLE' });
});

it('does not fund on the wrong chain and rejects an unsuccessful faucet receipt', async () => {
  mocks.chainId.mockResolvedValueOnce(8453);
  await expect(loadTestnetWallet({ X402_LIVE: '1' })).rejects.toThrow('CDP_UNAVAILABLE');
  expect(mocks.faucet).not.toHaveBeenCalled();
  mocks.balance.mockResolvedValue(0n);
  mocks.wait.mockResolvedValue({ status: 'reverted' });
  await expect(loadTestnetWallet({ X402_LIVE: '1' })).rejects.toThrow('CDP_UNAVAILABLE');
});
