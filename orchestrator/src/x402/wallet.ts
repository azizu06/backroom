import { testnetAccount } from './keychain';
// Only public addresses leave the process. Explicit setup; never replaces an existing key.
try {
  console.log(JSON.stringify({ label: 'x402 testnet', payer: testnetAccount('payer', true).address, vendor: testnetAccount('vendor', true).address }));
} catch { console.error('x402 testnet Keychain setup failed.'); process.exitCode = 1; }
