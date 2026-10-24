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
