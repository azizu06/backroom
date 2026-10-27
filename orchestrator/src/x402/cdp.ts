import { createPublicClient, erc20Abi, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { toClientEvmSigner, type ClientEvmSigner } from '@x402/evm';
import { cdpCredentials, cdpCredentialsPresent, testnetAccount } from './keychain';

export const CDP_ACCOUNT_NAME = 'backroom-payables';
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export type WalletLabel = 'Coinbase CDP server wallet' | 'direct testnet key';
export interface TestnetWallet extends ClientEvmSigner { walletLabel: WalletLabel }
const chain = () => createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org', { timeout: 20_000, retryCount: 0 }) });
async function balance(address: `0x${string}`) {
  const rpc = chain();
  if (await rpc.getChainId() !== 84532) throw new Error('CDP_UNAVAILABLE_WRONG_CHAIN');
  return rpc.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] });
}
async function client() {
  const credentials = cdpCredentials();
  // Keep CDP's multi-chain SDK out of normal Nessie/offline worker startup.
  const { CdpClient } = await import('@coinbase/cdp-sdk');
  return new CdpClient({ ...credentials, debugging: false });
}

/** Named server wallet, fixed testnet faucet and official CDP→x402 signer adapter. */
export async function loadTestnetWallet(env: Record<string, string | undefined> = process.env): Promise<TestnetWallet> {
  if (env.X402_LIVE !== '1') throw new Error('CDP_UNAVAILABLE_X402_LIVE_REQUIRED');
  // Fallback is explicit, only for absent credentials. Provider failures never switch wallets.
  if (!cdpCredentialsPresent()) {
    if (env.X402_ALLOW_DIRECT_KEY !== '1') throw new Error('CDP_UNAVAILABLE_KEYCHAIN_CREDENTIALS');
    const account = testnetAccount('payer');
    return { address: account.address, signTypedData: account.signTypedData, walletLabel: 'direct testnet key' };
  }
  try {
    const cdp = await client();
    const account = await cdp.evm.getOrCreateAccount({ name: CDP_ACCOUNT_NAME });
    if (await balance(account.address) < 50_000n) {
      const funded = await cdp.evm.requestFaucet({ address: account.address, network: 'base-sepolia', token: 'usdc' });
      const receipt = await chain().waitForTransactionReceipt({ hash: funded.transactionHash, timeout: 60_000 });
      if (receipt.status !== 'success' || await balance(account.address) < 50_000n) throw new Error();
    }
    return { ...toClientEvmSigner(account), walletLabel: 'Coinbase CDP server wallet' };
  } catch { throw new Error('CDP_UNAVAILABLE_ACCOUNT_OR_FAUCET'); }
}

/** Read-only: getAccount never creates/funds/signs, and this returns public data only. */
export async function cdpWalletBalance(): Promise<Record<string, string | number>> {
  try {
    const account = await (await client()).evm.getAccount({ name: CDP_ACCOUNT_NAME });
    return { status: 'AVAILABLE', walletLabel: 'Coinbase CDP server wallet', address: account.address,
      network: 'eip155:84532', asset: 'Base Sepolia test USDC', balanceAtomic: String(await balance(account.address)), decimals: 6 };
  } catch { return { status: 'UNAVAILABLE', reason: 'CDP wallet or Keychain credentials unavailable. Set up the named testnet wallet first.' }; }
}
