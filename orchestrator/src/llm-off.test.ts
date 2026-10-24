import { MemoryFinanceRepository } from './payables/repository';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryStateStore } from './store';
import { createRouter, TASK_ROUTES } from './router';
import { FakeEffects } from './effects';
import { SeatWorker } from './worker';
import type { APInvoice, Context } from '@backroom/policy';
import { routeInboxItem } from './inbox';

const completion = () => Response.json({ choices: [{ message: { content: JSON.stringify({ output: { ok: true }, confidence: 1 }) } }], usage: { cost: 0 } });
afterEach(() => vi.restoreAllMocks());
it('refuses every local/cloud task while OFF without touching the network, then resumes', async () => {
  const store = new MemoryStateStore();
  const network = vi.fn<typeof fetch>(async () => completion());
  const router = createRouter({ stateStore: store, fetch: network, cloudProvider: 'openrouter', cloudApiKey: 'test' });
  await store.setLlmEnabled(false);
  for (const task of Object.keys(TASK_ROUTES) as (keyof typeof TASK_ROUTES)[]) {
    expect(await router.route(task, {})).toMatchObject({ kind: 'LLM_OFF', route: 'code', costUsd: 0 });
  }
  await router.healthPing();
  expect(network).not.toHaveBeenCalled();
  await store.setLlmEnabled(true);
  expect(await router.route('call_plan', {})).toMatchObject({ route: 'cloud', output: { ok: true } });
  expect(network).toHaveBeenCalledTimes(1);
});
it('aborts an in-flight local call and suppresses cloud fallback and stale output, even after ON', async () => {
  const store = new MemoryStateStore();
  let finish!: (response: Response) => void;
  let requestSignal: AbortSignal | undefined;
  const network = vi.fn<typeof fetch>((_, init) => {
    requestSignal = init?.signal as AbortSignal;
    return new Promise(resolve => { finish = resolve; }); // provider may ignore abort
  });
  const router = createRouter({ stateStore: store, fetch: network, cloudProvider: 'openrouter', cloudApiKey: 'test' });
  const pending = router.route('field_extraction', {});
  await store.setLlmEnabled(false);
  expect(requestSignal?.aborted).toBe(true);
  await store.setLlmEnabled(true);
  finish(completion());
  expect(await pending).toMatchObject({ kind: 'LLM_OFF' });
  expect(network).toHaveBeenCalledTimes(1);
});

const invoice: APInvoice = { id: '4402', vendorId: 'acme', amountCents: 150000,
  lineItems: [{ description: 'Supplies', quantity: 1, unitPriceCents: 150000 }], poMatched: true, account: 'operating' };
const context: Context = { vendor: { id: 'acme', inMaster: true, approved: true,
  pendingBankChange: false, knownDomain: 'acme-supply.com' } };
it.each([
  ['4419', { ...invoice, id: '4419', amountCents: 153700 }, { ...context, priorInvoices: [invoice] }, 'DUPLICATE_INVOICE'],
  ['4471', { ...invoice, id: '4471' }, { vendor: { ...context.vendor!, pendingBankChange: true, sourceDomain: 'acme-supp1y.com' } }, 'LOOKALIKE_DOMAIN'],
  ['legitimate-bank-change', { ...invoice, id: 'legitimate' }, { vendor: { ...context.vendor!, pendingBankChange: true } }, 'BANK_CHANGE_HOLD'],
] as const)('flip mid-run: inbox routes %s, code holds it, clean payments continue', async (id, trap, ctx, rule) => {
  const store = new MemoryStateStore();
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => completion());
  const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [{ id: 'acme', domain: 'example.com', accountId: 'approved-bank', approved: true, revision: 1 }] }));
  const worker = new SeatWorker({ id: 'ap', seat: 'payables', store, effects, now: () => 0 });
  await worker.start();
  const pay = async (taskId: string, input: APInvoice, taskContext: Context) => {
    await store.enqueueTask({ id: taskId, seatId: 'payables', refs: [taskId], idempotencyKey: taskId, steps: [
      { kind: 'nessie', action: { type: 'pay_invoice' }, input: { invoice: input }, context: taskContext },
    ] });
    await worker.tick();
  };
  await pay('before', invoice, context);
  await store.setLlmEnabled(false);
  const start = (await store.listAudit()).length;
  await pay('clean-off', { ...invoice, id: 'clean-off' }, context);
  expect(await routeInboxItem({ id, kind: 'invoice' }, store)).toMatchObject({ seat: 'payables', source: 'code' });
  await pay(id, trap, ctx);
  expect((await store.listAudit()).filter(entry => entry.decision).at(-1)).toMatchObject({ decision: 'ESCALATE', ruleIds: [rule], actor: 'code' });
  expect(effects.calls).toHaveLength(2);
  expect((await store.listAudit()).slice(start).every(entry => entry.actor === 'code')).toBe(true);
  expect(network).not.toHaveBeenCalled();
});
it('pauses voice after evaluating its permit, keeps a code stop running, and resumes on ON', async () => {
  const store = new MemoryStateStore();
  const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [{ id: 'acme', domain: 'example.com', accountId: 'approved-bank', approved: true, revision: 1 }] }));
  const worker = new SeatWorker({ id: 'ar', seat: 'collections', store, effects, now: () => 0 });
  await worker.start();
  const client = { type: 'business' as const, phoneNumber: '+12025550101', dnc: false, localWeekday: 5, localHour: 10,
    consent: { source: 'seed', text: 'Consent', timestamp: '2026-10-24T00:00:00Z', number: '+12025550101' } };
  await store.enqueueTask({ id: 'voice', seatId: 'collections', refs: [], steps: [
    { kind: 'dial', action: { type: 'call_client' }, input: {}, context: { client } },
  ] });
  await store.setLlmEnabled(false);
  await worker.tick();
  expect((await store.getTask('voice'))?.status).toBe('paused');
  expect((await store.getAgent('ar'))?.state).toBe('paused');
  await store.enqueueTask({ id: 'dnc', seatId: 'collections', refs: [], steps: [
    { kind: 'dial', action: { type: 'call_client' }, input: {}, context: { client: { ...client, dnc: true } } },
  ] });
  await worker.tick();
  expect((await store.getTask('dnc'))?.status).toBe('denied');
  expect((await store.listAudit()).filter(entry => entry.decision).at(-1)).toMatchObject({ actor: 'code', ruleIds: ['DNC'] });
  expect(effects.calls).toHaveLength(0);
  await store.setLlmEnabled(true);
  await worker.tick();
  expect(effects.calls).toHaveLength(1);
  expect((await store.getTask('voice'))?.status).toBe('done');
});

it('falls back for every inbox kind while OFF, including emails normally classified by a model', async () => {
  const store = new MemoryStateStore();
  const network = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ output: { seat: 'collections' }, confidence: 1 }) } }] }));
  expect(await routeInboxItem({ id: 'on', kind: 'email' }, store, { fetch: network })).toMatchObject({ source: 'model', seat: 'collections' });
  await store.setLlmEnabled(false);
  for (const [kind, seat] of [['invoice', 'payables'], ['bank_change', 'payables'], ['client_message', 'collections'],
    ['vendor_message', 'vendor_onboarding'], ['email', 'vendor_onboarding']] as const) {
    expect(await routeInboxItem({ id: kind, kind }, store, { fetch: network })).toEqual({ source: 'code', seat });
  }
  expect(network).toHaveBeenCalledTimes(1);
  expect((await store.listAudit()).slice(1).every(entry => entry.actor === 'code')).toBe(true);
});
it('cancels an active voice effect on OFF without advancing or recording a successful completion', async () => {
  const store = new MemoryStateStore();
  const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [{ id: 'acme', domain: 'example.com', accountId: 'approved-bank', approved: true, revision: 1 }] }));
  let started!: () => void;
  const start = new Promise<void>(resolve => { started = resolve; });
  let effectSignal: AbortSignal | undefined;
  vi.spyOn(effects, 'dial').mockImplementation(({ signal }) => new Promise((_, reject) => {
    effectSignal = signal; started();
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  await store.registerAgent('voice', 'collections', 0);
  await store.enqueueTask({ id: 'call', seatId: 'collections', refs: [], steps: [
    { kind: 'dial', action: { type: 'call_client' }, context: {}, input: {} },
  ] });
  // This test isolates cancellation; legal permit behavior is tested above with real policy.
  const permitWorker = new SeatWorker({ id: 'voice', seat: 'collections', store, effects, now: () => 0,
    evaluate: () => ({ kind: 'ALLOW', ruleIds: ['IN_BADGE'], policyVersion: 1 }) });
  const running = permitWorker.tick();
  await start;
  await store.setLlmEnabled(false);
  await running;
  expect(effectSignal?.aborted).toBe(true);
  expect(await store.getTask('call')).toMatchObject({ status: 'paused', cursor: 0 });
  expect((await store.listAudit()).some(entry => entry.action === 'dial_completed')).toBe(false);
});
