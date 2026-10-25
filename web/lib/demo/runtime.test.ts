import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { NessieClient, paymentMemo } from '@backroom/nessie';
import { getStateStore, MemoryStateStore, PaymentService } from '@backroom/orchestrator';
import { getPaymentService } from '../payments/runtime';
import { createDemoRuntime } from './runtime';

let runtime: Awaited<ReturnType<typeof createDemoRuntime>> | undefined;
afterEach(async () => { await runtime?.stop(); vi.restoreAllMocks(); });
it('resets synthetic company, gateway approvals and payments into one shared state', async () => {
  runtime = await createDemoRuntime();
  const first = runtime.status();
  expect(first.payPath).toMatch(/^\/pay\//);
  const id = first.approvePath!.split('/').at(-1)!;
  expect(await getStateStore().getEscalation(id)).toMatchObject({ status: 'pending', invoiceId: '1042' });
  expect((await getStateStore().getAgent('demo:collections'))?.seatId).toBe('collections');
  const linkId = first.payPath!.split('/').at(-1)!;
  // Simulate a slow reducer response after enqueue commits: the seat must not steal this task.
  const enqueue = MemoryStateStore.prototype.enqueueTask;
  vi.spyOn(MemoryStateStore.prototype, 'enqueueTask').mockImplementation(async function (this: MemoryStateStore, task) {
    await enqueue.call(this, task);
    if (task.id.startsWith('demo:reconcile:')) await new Promise(resolve => setTimeout(resolve, 200));
  });
  const payment = await getPaymentService().pay(linkId);
  expect(payment.status).toBe('partially_paid');
  expect((await getStateStore().getPayment('ar:1042:1'))?.result.amountCents).toBe(247500);
  await getStateStore().setLlmEnabled(true);
  await runtime.reset();
  expect(runtime.status().llmEnabled).toBe(false);
  expect(await getStateStore().getPayment('ar:1042:1')).toBeUndefined();
  await expect(getPaymentService().view(linkId)).rejects.toThrow('PAYMENT_LINK_NOT_FOUND');
  expect(await getStateStore().getEscalation(id)).toBeUndefined();
  expect((await getStateStore().verifyAuditChain()).valid).toBe(true);
});
it('registers an unverified voice call into the same gateway and reconciles its ALLOW link', async () => {
  const { getGatewayStore, handleTool } = await import('../gateway/runtime');
  const { resolvePaymentCode } = await import('../payments/delivery');
  const { randomUUID } = await import('node:crypto');
  process.env.TOOL_GATEWAY_SECRET = 'voice-test';
  runtime = await createDemoRuntime();
  const callId = randomUUID();
  await runtime.registerVoiceCall(callId);
  const invoke = async (tool: string, args = {}) => (await handleTool(tool, new Request('http://localhost', {
    method: 'POST', headers: { authorization: 'Bearer voice-test' },
    body: JSON.stringify({ call_id: callId, webhook_request_id: randomUUID(), ...args }),
  }))).json();
  expect((await invoke('get_invoice_context')).rule_ids).toEqual(['IDENTITY_REQUIRED']);
  await invoke('verify_identity_result', { result: 'confirmed' });
  const plan = await invoke('propose_plan', { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
  const sent = await invoke('send_payment_link', { plan_id: plan.plan_id });
  const link = await resolvePaymentCode(getGatewayStore(), sent.short_code);
  expect(link?.amountCents).toBe(247500);
  const id = link!.path.split('/').at(-1)!;
  expect((await getPaymentService().pay(id)).status).toBe('partially_paid');
  expect((await getStateStore().getPayment('ar:1042:1'))?.result.amountCents).toBe(247500);
  delete process.env.TOOL_GATEWAY_SECRET;
});

it('mirrors the bank feed after pay and reconcile, and a replay does not add a row', async () => {
  runtime = await createDemoRuntime();
  const store = getStateStore() as MemoryStateStore;
  const record = vi.spyOn(store, 'recordBankTxn');
  const linkId = runtime.status().payPath!.split('/').at(-1)!;
  expect((await getPaymentService().pay(linkId)).status).toBe('partially_paid');
  expect(record).toHaveBeenCalledTimes(2);
  expect(record.mock.calls[0]![0]).toEqual(record.mock.calls[1]![0]);
  expect(await store.listBankTxns()).toEqual([record.mock.calls[0]![0]]);
  record.mockClear();
  expect((await getPaymentService().pay(linkId)).status).toBe('partially_paid');
  expect(record).not.toHaveBeenCalled();
  expect(await store.listBankTxns()).toHaveLength(1);
});

it('schedules one pending-reconciliation sweep and clears it when the host stops', async () => {
  const scheduled: Array<() => void> = [];
  const realSet = globalThis.setInterval;
  const setSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
    if (ms === 5_000 && typeof fn === 'function') { scheduled.push(() => { fn(); }); return 1 as unknown as ReturnType<typeof setInterval>; }
    return realSet(fn as never, ms as never, ...(rest as []));
  }) as unknown as typeof setInterval);
  const clearSpy = vi.spyOn(globalThis, 'clearInterval');
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    runtime = await createDemoRuntime();
    expect(scheduled).toHaveLength(1);
    const service = getPaymentService();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const pending = vi.spyOn(service, 'retryPending').mockImplementation(() => { calls += 1; return gate.then(() => []); });
    scheduled[0]!();
    scheduled[0]!();
    expect(calls).toBe(1);
    const flush = () => new Promise(resolve => setImmediate(resolve));
    release();
    await gate;
    await flush();
    scheduled[0]!();
    expect(calls).toBe(2);
    await flush();
    pending.mockReset();
    pending.mockRejectedValue(new Error('retry-down'));
    scheduled[0]!();
    await flush();
    expect(logged).toHaveBeenCalledWith('demo pending reconciliation retry failed', expect.any(Error));
    expect(runtime.status().workersHealthy).toBe(true);
    await runtime.stop();
    expect(clearSpy).toHaveBeenCalled();
    scheduled[0]!();
    expect(calls).toBe(2);
  } finally {
    setSpy.mockRestore();
    clearSpy.mockRestore();
    logged.mockRestore();
  }
});

it('recovers the active pay link before the pending sweep starts', async () => {
  const events: string[] = [];
  const original = PaymentService.prototype.recover;
  const recover = vi.spyOn(PaymentService.prototype, 'recover').mockImplementation(function (this: PaymentService, linkIds, store) {
    events.push('recover');
    return original.call(this, linkIds, store);
  });
  const realSet = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
    if (ms === 5_000) { events.push('arm'); return 1 as unknown as ReturnType<typeof setInterval>; }
    return realSet(fn as never, ms as never, ...(rest as []));
  }) as unknown as typeof setInterval);
  runtime = await createDemoRuntime();
  const linkId = runtime.status().payPath!.split('/').at(-1)!;
  expect(events).toEqual(['recover', 'arm']);
  expect(recover).toHaveBeenCalledWith([linkId], expect.anything());
});

it('keeps booting when payment recovery throws', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  let armed = false;
  const realSet = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: TimerHandler, ms?: number, ...rest: unknown[]) => {
    if (ms === 5_000) { armed = true; return 1 as unknown as ReturnType<typeof setInterval>; }
    return realSet(fn as never, ms as never, ...(rest as []));
  }) as unknown as typeof setInterval);
  vi.spyOn(PaymentService.prototype, 'recover').mockRejectedValue(new Error('recover-down'));
  runtime = await createDemoRuntime();
  expect(logged).toHaveBeenCalledWith('demo payment recovery failed', expect.any(Error));
  expect(armed).toBe(true);
  expect(runtime.status().workersHealthy).toBe(true);
});

it('does not give a new pay link a deposit that already existed for invoice 1042 installment 1', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  const deposit = { _id: 'old-deposit', amount: 2475, description: paymentMemo({ invoiceId: '1042', installment: 1 }),
    status: 'completed', medium: 'balance', transaction_date: '2026-10-24' };
  vi.spyOn(NessieClient.prototype, 'listDeposits').mockResolvedValue([deposit]);
  runtime = await createDemoRuntime();
  const linkId = runtime.status().payPath!.split('/').at(-1)!;
  expect((await getPaymentService().view(linkId)).payment).toBeUndefined();
  expect(logged).toHaveBeenCalledWith('demo payment recovery skipped', { linkId, reason: 'NEW_LINK_EXISTING_DEPOSIT' });
});

it('turns Nessie Verified from the live sandbox deposit that reconciled as EXACT_PAYMENT_MATCH', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const claims = mkdtempSync(join(tmpdir(), 'nessie-proof-'));
  for (const [key, value] of Object.entries({ DEMO_LIVE: '1', DEMO_LLM: 'off', NESSIE_API_KEY: 'private', NESSIE_ACCOUNT_ID: 'sandbox-account',
    NESSIE_CLAIMS_DIR: claims, PRECALL_APIFY: 'fake', PRECALL_CRS: 'fake', GX10_ENABLED: 'false' })) vi.stubEnv(key, value);
  const deposits: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const { hostname, pathname } = new URL(String(url));
    if (hostname !== 'prod-api.nessieisreal.com') throw new Error('offline test');
    if (init?.method === 'POST') {
      const row = { ...JSON.parse(String(init.body)), _id: 'sandbox-deposit-1', status: 'completed' };
      deposits.push(row); return Response.json({ objectCreated: row });
    }
    return Response.json(pathname.endsWith('/deposits') ? deposits : { balance: 0 });
  }));
  try {
    runtime = await createDemoRuntime();
    expect(runtime.status().services?.nessie.proof?.kind).toBe('sandbox_read');
    const linkId = runtime.status().payPath!.split('/').at(-1)!;
    expect((await getPaymentService().pay(linkId)).status).toBe('partially_paid');
    expect(runtime.status().services?.nessie.proof).toMatchObject({ kind: 'deposit_exact_match', depositId: 'sandbox-deposit-1' });
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs(); rmSync(claims, { recursive: true, force: true });
  }
});
