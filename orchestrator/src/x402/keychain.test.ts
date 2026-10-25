import { afterEach, expect, it, vi } from 'vitest';
const security = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawnSync: security }));
import { cdpCredentials } from './keychain';

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(() => { Object.defineProperty(process, 'platform', platform); vi.clearAllMocks(); });

it.each(['plain', 'hex', 'prefixed hex'])('loads %s Keychain API JSON without exposing credentials', format => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  const json = '{\n  "id": "test-id",\n  "privateKey": "test-secret"\n}';
  const value = format === 'plain' ? json : `${format === 'prefixed hex' ? '0x' : ''}${Buffer.from(json).toString('hex')}`;
  security.mockImplementation((_command, args: string[]) => ({ status: 0, stdout: args.includes('backroom-cdp-api-key') ? value : 'test-wallet-secret' }));
  expect(cdpCredentials()).toEqual({ apiKeyId: 'test-id', apiKeySecret: 'test-secret', walletSecret: 'test-wallet-secret' });
  expect(security.mock.calls.every(([, args]) => args.at(-1) === '-w')).toBe(true);
});
