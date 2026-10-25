import { spawnSync } from 'node:child_process';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const service = 'backroom-x402-testnet-key';
/** Keys never enter env, argv, output, or a file. security's interactive stdin is private. */
export function testnetAccount(role: 'payer' | 'vendor', create = false) {
  if (process.platform !== 'darwin') throw new Error('X402_REQUIRES_MACOS_KEYCHAIN');
  const read = () => spawnSync('/usr/bin/security', ['find-generic-password', '-s', service, '-a', role, '-w'], { encoding: 'utf8' });
  let result = read();
  if (result.status !== 0 && create) {
    // Only create on item-not-found; never replace an inaccessible existing wallet.
    if (result.status !== 44) throw new Error('X402_KEYCHAIN_UNAVAILABLE');
    const key = generatePrivateKey();
    const saved = spawnSync('/usr/bin/security', ['-i'], {
      input: `add-generic-password -s ${service} -a ${role} -w ${key}\n`, encoding: 'utf8',
    });
    if (saved.status !== 0 || saved.stderr.includes('SecKeychain')) throw new Error('X402_KEYCHAIN_WRITE_FAILED');
    result = read();
  }
  const key = result.stdout.trim();
  if (result.status !== 0 || !/^0x[0-9a-f]{64}$/i.test(key)) throw new Error('X402_KEYCHAIN_KEY_MISSING');
  return privateKeyToAccount(key as `0x${string}`);
}
/** Presence only: omits `-w`, so the secret never enters this process. */
export function testnetKeyPresent(role: 'payer' | 'vendor') {
  if (process.platform !== 'darwin') return false;
  return spawnSync('/usr/bin/security', ['find-generic-password', '-s', service, '-a', role], { stdio: 'ignore' }).status === 0;
}

/** CDP credentials are read only in the host process, never from environment/files. */
export function cdpCredentials() {
  if (process.platform !== 'darwin') throw new Error('CDP_UNAVAILABLE_MACOS_KEYCHAIN_REQUIRED');
  const read = (item: string) => {
    const result = spawnSync('/usr/bin/security', ['find-generic-password', '-s', item, '-w'], { encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout.trim()) throw new Error('CDP_UNAVAILABLE_KEYCHAIN_CREDENTIALS');
    return result.stdout.trim();
  };
  try {
    const api = JSON.parse(read('backroom-cdp-api-key')) as { id?: unknown; privateKey?: unknown };
    const walletSecret = read('backroom-cdp-wallet-secret');
    if (typeof api.id !== 'string' || !api.id || typeof api.privateKey !== 'string' || !api.privateKey) throw new Error();
    return { apiKeyId: api.id, apiKeySecret: api.privateKey, walletSecret };
  } catch { throw new Error('CDP_UNAVAILABLE_KEYCHAIN_CREDENTIALS'); }
}

/** Presence only; never reads secret values. */
export function cdpCredentialsPresent() {
  return process.platform === 'darwin' && ['backroom-cdp-api-key', 'backroom-cdp-wallet-secret'].every(item =>
    spawnSync('/usr/bin/security', ['find-generic-password', '-s', item], { stdio: 'ignore' }).status === 0);
}
