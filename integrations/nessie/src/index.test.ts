import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { FileClaims, NessieClient, withdrawalMemo } from './index.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function setup(fetcher: typeof fetch, options: { surface?: 'mock' | 'nessie_sandbox' } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'nessie-')); dirs.push(dir);
  return { dir, client: new NessieClient({ apiKey: 'secret', claims: new FileClaims(dir), fetch: fetcher, ...options }) };
}
it('R13: concurrent clients sharing durable claims issue only one POST', async () => {
  const deposits: unknown[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'POST') {
      const deposit = { _id: 'd1', ...JSON.parse(String(init.body)) };
      deposits.push(deposit);
      return Response.json({ objectCreated: deposit }, { status: 201 });
    }
    return Response.json(deposits);
  });
  const { client, dir } = await setup(fetcher);
  const other = new NessieClient({ apiKey: 'secret', claims: new FileClaims(dir), fetch: fetcher });
  const payment = { accountId: 'a1', invoiceId: '1042', installment: 1, amountCents: 240000 };
  await Promise.allSettled([client.deposit(payment), other.deposit(payment)]);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect((await other.deposit(payment))._id).toBe('d1');
  await expect(other.deposit({ ...payment, amountCents: 100 })).rejects.toThrow('conflict');
});
it('creates one sandbox withdrawal per invoice and reconciles the exact debit from the bank feed', async () => {
  const withdrawals: unknown[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    expect(new URL(String(url)).pathname).toBe('/accounts/a1/withdrawals');
    if (init?.method === 'POST') {
      const withdrawal = { _id: 'w1', ...JSON.parse(String(init.body)) };
      withdrawals.push(withdrawal);
      return Response.json({ objectCreated: withdrawal }, { status: 201 });
    }
    return Response.json(withdrawals);
  });
  const { client, dir } = await setup(fetcher);
  const debit = { accountId: 'a1', vendorId: 'papertrail', invoiceId: '4401', amountCents: 64000 };
  expect((await client.withdraw(debit))._id).toBe('w1');
  const restarted = new NessieClient({ apiKey: 'secret', claims: new FileClaims(dir), fetch: fetcher });
  expect((await restarted.withdraw(debit))._id).toBe('w1');
  expect(await restarted.reconcileWithdrawal(debit, 'w1')).toEqual({
    match: 'EXACT', debitId: 'w1', transactionId: 'w1', amountCents: 64000,
  });
  expect(withdrawalMemo(debit)).toBe('backroom:ap_vendor=papertrail:invoice=4401');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
it('recovers a withdrawal after a lost POST response and never debits the invoice twice after restart', async () => {
  const withdrawals: unknown[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'POST') {
      withdrawals.push({ _id: 'w-lost', ...JSON.parse(String(init.body)) });
      throw new Error('network failure with secret URL');
    }
    return Response.json(withdrawals);
  });
  const { client, dir } = await setup(fetcher);
  const debit = { accountId: 'a1', vendorId: 'papertrail', invoiceId: '4401', amountCents: 64000 };
  expect((await client.withdraw(debit))._id).toBe('w-lost');
  const restarted = new NessieClient({ apiKey: 'secret', claims: new FileClaims(dir), fetch: fetcher });
  expect((await restarted.withdraw(debit))._id).toBe('w-lost');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
it('rejects fractional-dollar amounts before touching the integer-only sandbox', async () => {
  const fetcher = vi.fn<typeof fetch>(); const { client } = await setup(fetcher);
  await expect(client.deposit({ accountId: 'a1', invoiceId: '1042', installment: 1, amountCents: 125 })).rejects.toThrow('whole-dollar');
  expect(fetcher).not.toHaveBeenCalled();
});
it('R13: a lost POST response recovers a persisted deposit without posting again', async () => {
  const deposits: unknown[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'POST') {
      deposits.push({ _id: 'd2', ...JSON.parse(String(init.body)) });
      throw new Error('network failure with secret URL');
    }
    return Response.json(deposits);
  });
  const { client } = await setup(fetcher);
  const payment = { accountId: 'a1', invoiceId: '1042', installment: 1, amountCents: 200 };
  expect((await client.deposit(payment))._id).toBe('d2');
  expect((await client.deposit(payment))._id).toBe('d2');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
it('R13: an uncertain absent deposit stays reserved across a process restart', async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'POST') throw new Error('secret must not escape');
    return Response.json([]);
  });
  const { client, dir } = await setup(fetcher);
  const payment = { accountId: 'a1', invoiceId: '1042', installment: 1, amountCents: 200 };
  await expect(client.deposit(payment)).rejects.toThrow('uncertain');
  const restarted = new NessieClient({ apiKey: 'secret', claims: new FileClaims(dir), fetch: fetcher });
  await expect(restarted.deposit(payment)).rejects.toThrow('will not re-POST');
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
});
it('retries transient reads, reports bank balance verbatim, and sanitizes provider errors', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ balance: 42 }))
    .mockRejectedValue(new Error('https://bank/?key=secret'));
  const { client } = await setup(fetcher);
  expect(await client.readBalance('a1')).toBe(42);
  await expect(client.getCustomer('c1')).rejects.toThrow('response uncertain');
  await expect(client.getCustomer('c1')).rejects.not.toThrow('secret');
});
it('seeds Northfield once and reads the same customer and checking account on replay', async () => {
  const customers: unknown[] = [], accounts: unknown[] = [];
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const rows = new URL(String(url)).pathname === '/customers' ? customers : accounts;
    if (init?.method === 'POST') {
      const created = { _id: rows === customers ? 'c1' : 'a1', ...JSON.parse(String(init.body)) };
      rows.push(created); return Response.json({ objectCreated: created }, { status: 201 });
    }
    return Response.json(rows);
  });
  const { client, dir } = await setup(fetcher);
  const { seedNorthfield } = await import('./index.js');
  const first = await seedNorthfield(client, new FileClaims(dir));
  expect(await seedNorthfield(client, new FileClaims(dir))).toEqual(first);
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
});
it('labels a display total derived only from API balance and completed balance deposits', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ balance: 10 }))
    .mockResolvedValueOnce(Response.json([
      { _id: 'd1', amount: 2, status: 'completed', medium: 'balance' },
      { _id: 'd2', amount: 99, status: 'pending', medium: 'balance' },
      { _id: 'd3', amount: 88, status: 'cancelled', medium: 'balance' },
      { _id: 'd4', amount: 77, status: 'completed', medium: 'rewards' },
    ]));
  const { client } = await setup(fetcher);
  const live = (await import('./index.js')).bankSurfaceCopy('nessie_sandbox');
  expect(await client.readBalanceWithPostedDeposits('a1')).toEqual({
    ...live,
    label: live.postedDepositsLabel, accountBalance: 10, postedDepositsTotal: 2,
    displayTotal: 12, postedDepositIds: ['d1'],
  });
});
it('labels a mock adapter as an offline bank, not the Nessie sandbox', async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ balance: 10 }))
    .mockResolvedValueOnce(Response.json([{ _id: 'mock-deposit-1', amount: 2, status: 'completed', medium: 'balance' }]));
  const { client } = await setup(fetcher, { surface: 'mock' });
  const display = await client.readBalanceWithPostedDeposits('a1');
  expect(display.sandboxLabel).toBe('Offline bank');
  expect(display.cardNotice).toBe('Offline bank; no card is charged.');
  expect(display.panelLine).toBe('Offline bank · no card charged');
  expect(display.sandboxLabel).not.toContain('Nessie');
  expect(client.surfaceCopy().surface).toBe('mock');
});
it.each([
  [{ _id: 'd1', amount: 2, status: 'completed', medium: 'balance' }, { _id: 'd1', amount: 2, status: 'completed', medium: 'balance' }],
  [{ _id: 'd1', amount: -1, status: 'completed', medium: 'balance' }],
])('refuses an unsafe API-derived display for duplicate IDs or invalid amounts', async (...rows) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ balance: 0 })).mockResolvedValueOnce(Response.json(rows));
  const { client } = await setup(fetcher);
  await expect(client.readBalanceWithPostedDeposits('a1')).rejects.toThrow('invalid posted deposit');
});
