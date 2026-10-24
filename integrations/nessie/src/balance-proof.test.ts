import { describe, expect, it } from 'vitest';
import { NessieClient, SANDBOX_LABEL, type Account, type Transaction } from './index';
import { runBalanceProof } from './balance-proof';

/** In-memory Nessie. By default it behaves like the hosted sandbox: deposits never reach account.balance. */
function sandbox(options: { appliesDeposits?: boolean; customers?: number } = {}) {
  const accounts: Account[] = [{ _id: 'acct-northfield', customer_id: 'cust-1', type: 'Checking',
    nickname: `Northfield Studio Checking (${SANDBOX_LABEL})`, balance: 0, rewards: 0 }];
  const deposits = new Map<string, Transaction[]>([['acct-northfield', [
    { _id: 'dep-old', amount: 2, description: 'backroom:T4', status: 'completed', medium: 'balance', transaction_date: '2026-10-24' }]]]);
  const posts: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (init?.method === 'POST') posts.push(path);
    if (path === '/customers') return Response.json(Array.from({ length: options.customers ?? 1 }, (_, i) =>
      ({ _id: `cust-${i + 1}`, first_name: 'Northfield', last_name: 'Studio' })));
    let match = path.match(/^\/customers\/([^/]+)\/accounts$/);
    if (match && init?.method === 'POST') {
      const account = { ...body, _id: `acct-${accounts.length}`, customer_id: match[1] };
      accounts.push(account); deposits.set(account._id, []);
      return Response.json({ code: 201, objectCreated: account }, { status: 201 });
    }
    if (match) return Response.json(accounts.filter(a => a.customer_id === match![1]));
    match = path.match(/^\/accounts\/([^/]+)\/deposits$/);
    if (match && init?.method === 'POST') {
      const row = { ...body, _id: `dep-${posts.length}` };
      deposits.get(match[1]!)!.push(row);
      if (options.appliesDeposits) accounts.find(a => a._id === match![1])!.balance += body.amount;
      return Response.json({ code: 201, objectCreated: row }, { status: 201 });
    }
    if (match) return Response.json(deposits.get(match[1]!) ?? []);
    match = path.match(/^\/accounts\/([^/]+)$/);
    if (match) return Response.json(accounts.find(a => a._id === match![1]));
    return new Response('{}', { status: 404 });
  };
  const claimed = new Set<string>();
  const claims = { claim: async (key: string) => !claimed.has(key) && !!claimed.add(key) };
  return { client: new NessieClient({ apiKey: 'k', claims, fetch, readAttempts: 1 }), claims, accounts, posts };
}
const now = () => new Date('2026-10-24T21:05:00Z');
const noSleep = async () => {};

describe('Nessie balance proof (#231)', () => {
  it('reads only by default: re-checks Northfield and writes nothing', async () => {
    const s = sandbox();
    const result = await runBalanceProof(s.client, s.claims, { confirm: false, depositDollars: 1, now });
    expect(result.northfield).toMatchObject({ accountBalance: 0, postedDepositsTotal: 2, displayTotal: 2, oldestDepositDate: '2026-10-24', providerApplied: false });
    expect(result.fresh).toBeUndefined();
    expect(s.posts).toEqual([]);
  });

  it('creates a fresh $0 account whose labelled display rises while the sandbox balance stays put', async () => {
    const s = sandbox();
    const result = await runBalanceProof(s.client, s.claims, { confirm: true, depositDollars: 25, now, sleep: noSleep, pollAttempts: 3 });
    expect(result.fresh).toMatchObject({ nickname: `Backrooms Demo Payee 20261024-2105 (${SANDBOX_LABEL})`,
      before: { accountBalance: 0, displayTotal: 0 }, after: { accountBalance: 0, postedDepositsTotal: 25, displayTotal: 25 },
      providerBalanceRose: false, displayRose: true, polls: 3 });
    expect(s.accounts.at(-1)).toMatchObject({ balance: 0, rewards: 0, type: 'Checking' });
  });

  it('stops polling and reports a real rise if the provider ever applies deposits', async () => {
    const s = sandbox({ appliesDeposits: true });
    const result = await runBalanceProof(s.client, s.claims, { confirm: true, depositDollars: 1, now, sleep: noSleep });
    expect(result.fresh).toMatchObject({ before: { accountBalance: 0 }, after: { accountBalance: 1 }, providerBalanceRose: true, polls: 1 });
  });

  it('creates the account only with --deposit 0, and reuses it on a rerun in the same minute', async () => {
    const s = sandbox();
    const first = await runBalanceProof(s.client, s.claims, { confirm: true, depositDollars: 0, now });
    const again = await runBalanceProof(s.client, s.claims, { confirm: true, depositDollars: 0, now });
    expect(again.fresh!.accountId).toBe(first.fresh!.accountId);
    expect(first.fresh).toMatchObject({ depositId: undefined, displayRose: false, polls: 0 });
    expect(s.posts.filter(p => p.endsWith('/deposits'))).toEqual([]);
    expect(s.posts).toHaveLength(1);
  });

  it('refuses fractional or negative deposits and an ambiguous or missing customer', async () => {
    for (const depositDollars of [1.5, -1]) {
      await expect(runBalanceProof(sandbox().client, sandbox().claims, { confirm: true, depositDollars, now })).rejects.toThrow('whole number');
    }
    await expect(runBalanceProof(sandbox({ customers: 2 }).client, sandbox().claims, { confirm: true, depositDollars: 1, now })).rejects.toThrow('ambiguous');
    await expect(runBalanceProof(sandbox({ customers: 0 }).client, sandbox().claims, { confirm: true, depositDollars: 1, now })).rejects.toThrow('seed');
  });
});
