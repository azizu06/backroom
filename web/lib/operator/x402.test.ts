import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { MemoryStateStore, runX402Console, x402TestnetAvailability, type X402ConsoleRun } from '@backroom/orchestrator';
import { createOperatorHTTP } from './http';
import { operatorSession } from './session';

const env = { DEMO_CONTROL_SECRET: 'private-host-key', DEMO_PORT: '3397' };
const origin = 'http://127.0.0.1:3397';
const request = (action: string, method = 'POST') => new Request(`${origin}/api/operator/${action}`, { method,
  headers: { origin, cookie: operatorSession(env, origin), 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });

describe('operator x402 vendor payments', () => {
  const store = new MemoryStateStore(), key = `0x${randomBytes(32).toString('hex')}` as const;
  const handle = createOperatorHTTP({ env: () => env, store: () => store,
    run: action => runX402Console(action.slice('x402_'.length) as X402ConsoleRun, store,
      { env: {}, simulatedKey: () => key, keyPresent: () => { throw new Error('Keychain must not be touched'); } }),
    session: () => ({ x402Testnet: x402TestnetAvailability({}, 'darwin') }) });

  it('pays the simulated invoice, records audits, and never returns key material', async () => {
    const response = await handle('x402_simulated', request('x402_simulated'));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain(key.slice(2));
    expect(text).not.toContain('private-host-key');
    const body = JSON.parse(text);
    expect(body.result).toMatchObject({ rail: 'x402 simulated', status: 'paid', policy: { decision: 'ALLOW' } });
    expect(body.result.paymentAuditHref).toMatch(/^\/audit\?entry=/);
    const actions = (await store.listAudit()).map(row => row.action);
    expect(actions).toEqual(expect.arrayContaining(['operator_x402_simulated', 'x402_simulated_completed']));
  });

  it('holds the blocked invoice with no signature and explains an unavailable testnet', async () => {
    const blocked = await (await handle('x402_blocked', request('x402_blocked'))).json();
    expect(blocked.result).toMatchObject({ status: 'held', policy: { decision: 'ESCALATE' }, proof: { signatures: 0, vendorRequests: 0 } });
    const testnet = await handle('x402_testnet', request('x402_testnet'));
    expect(testnet.status).toBe(422);
    expect((await testnet.json()).error).toContain('X402_LIVE=1');
    const session = await (await handle('session', request('session', 'GET'))).json();
    expect(session).toMatchObject({ authorized: true, x402Testnet: { available: false, reason: expect.stringContaining('X402_LIVE=1') } });
  });
});
