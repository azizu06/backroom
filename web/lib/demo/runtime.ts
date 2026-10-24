/** Trusted, opt-in local rehearsal host. Never imported by normal Next bootstrap. */
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { MemoryStateStore, SpacetimeStateStore, SpacetimeTransport, type SpacetimeOptions, installStateStore, getStateStore, SeatWorker, FakeEffects,
  northfield, createNorthfieldRepository, PaymentService, type Seat, type InvoiceState } from '@backroom/orchestrator';
import { createDemoServices, installDemoServiceStatus } from './services';
import { createGateway } from '../gateway/http';
import { installGatewayStore } from '../gateway/runtime';
import { MemoryGatewayStore, type GatewayCall } from '../gateway/store';
import { createApprovalBridge } from '../approvals/gateway';
import { authorizedPaymentLink } from '../payments/authorization';
import { installPaymentService } from '../payments/runtime';
import type { DemoStatus } from '../../../tools/demo/health';

export async function createDemoRuntime() {
  let services = await createDemoServices();
  installDemoServiceStatus(() => services.status().services);
  const mode = process.env.STATE_STORE === 'spacetime' ? 'spacetime' : 'memory';
  let config: SpacetimeOptions = { uri: process.env.SPACETIMEDB_URI || '', database: process.env.SPACETIMEDB_DATABASE || '', token: process.env.SPACETIMEDB_TOKEN || '' };
  let abort = new AbortController();
  let jobs: Promise<void>[] = [];
  let paths: Pick<DemoStatus, 'approvePath' | 'payPath'> = {};
  let failed = false;
  let gatewayStore: MemoryGatewayStore;
  let collectionTail = Promise.resolve();
  async function collections<T>(work: () => Promise<T>): Promise<T> {
    const prior = collectionTail; let release!: () => void;
    collectionTail = new Promise<void>(resolve => { release = resolve; });
    await prior; try { return await work(); } finally { release(); }
  }
  async function stop() { abort.abort(); await Promise.all(jobs); jobs = []; }
  async function reset(next?: SpacetimeOptions) {
    if (next) config = next;
    await stop();
    if (!services.status().live) services = await createDemoServices();
    abort = new AbortController(); failed = false;
    const transport = mode === 'spacetime' ? new SpacetimeTransport(config) : undefined;
    if (transport) await transport.seedCompany(northfield);
    const state = transport ? new SpacetimeStateStore({ transport }) : new MemoryStateStore();
    const prior = getStateStore();
    await installStateStore(state);
    if (prior instanceof SpacetimeStateStore) await prior.close();
    await state.setLlmEnabled(process.env.DEMO_LLM === 'on' || (process.env.DEMO_LIVE === '1' && process.env.DEMO_LLM !== 'off'));
    await services.prepare(state);
    if (!transport) for (const invoice of northfield.arInvoices) await state.insertInvoice({ id: invoice.id, kind: 'ar', state: invoice.status as InvoiceState });
    if (!transport) for (const invoice of northfield.apInvoices) await state.insertInvoice({ id: invoice.id, kind: 'ap', state: invoice.status as InvoiceState });
    // This is a preverified synthetic call, never a live caller identity assertion.
    const invoice = northfield.arInvoices.find(row => row.id === '1042')!;
    const call: GatewayCall = { callId: 'demo-collections-1042', agentId: 'demo:collections', invoiceId: invoice.id,
      clientId: invoice.clientId, contactName: 'Jordan', companyName: northfield.company.name,
      amountCents: invoice.principalCents + invoice.lateFeeCents,
      receivable: { principalCents: invoice.principalCents, lateFeeCents: invoice.lateFeeCents },
      currency: 'USD', policyVersion: northfield.policyVersion, identityConfirmed: true,
      status: 'active', audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {} };
    gatewayStore = new MemoryGatewayStore([call], state);
    installGatewayStore(gatewayStore);
    const gateway = createGateway({ store: gatewayStore, secret: () => 'demo-bootstrap-only',
      currentPolicy: () => state.getPolicy(), approvalBridge: createApprovalBridge(state) });
    const invoke = async (tool: string, args: object): Promise<Record<string, unknown>> => {
      const response = await gateway(tool, new Request(`http://localhost/api/tools/${tool}`, { method: 'POST',
        headers: { authorization: 'Bearer demo-bootstrap-only', 'content-type': 'application/json' },
        body: JSON.stringify({ call_id: call.callId, webhook_request_id: randomUUID(), ...args }) }));
      if (!response.ok) throw new Error('DEMO_SEED_FAILED');
      return response.json();
    };
    const escalation = await invoke('propose_plan', { installments: 4, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
    const plan = await invoke('propose_plan', { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
    const link = await invoke('send_payment_link', { plan_id: plan.plan_id });
    paths = { approvePath: escalation.approval_path as string, payPath: link.link_path as string };
    // Advance the scripted ALLOW to promised using the same reducer path as the core demo.
    const bookkeeper = 'demo:reconcile';
    await state.registerAgent(bookkeeper, 'collections', Date.now());
    await state.enqueueTask({ id: 'demo:promise:1042', seatId: 'collections', refs: [invoice.id], steps: [] });
    const promiseLease = await state.claimTask(bookkeeper, Date.now(), 12000);
    if (!promiseLease) throw new Error('DEMO_PROMISE_LEASE');
    await state.transitionInvoice(promiseLease, invoice.id, 'overdue', 'in_collection', Date.now());
    await state.transitionInvoice(promiseLease, invoice.id, 'in_collection', 'promised', Date.now());
    await state.completeTask(promiseLease, 'done', Date.now());
    const service: PaymentService = new PaymentService({ bank: services.bank, accountId: services.accountId,
      lookup: async id => { const stored = await gatewayStore.findPaymentCall(id); return stored && authorizedPaymentLink(stored, id); },
      onPosted: id => collections(async () => {
        const agent = 'demo:reconcile';
        await state.heartbeat(agent, Date.now());
        await state.enqueueTask({ id: `demo:reconcile:${id}`, seatId: 'collections', refs: [invoice.id], idempotencyKey: `ar:${invoice.id}:1`, steps: [] });
        const lease = await state.claimTask(agent, Date.now(), 12000);
        if (!lease) throw new Error('DEMO_RECONCILIATION_LEASE');
        await service.reconcile(id, state, lease, 'promised');
        await state.completeTask(lease, 'done', Date.now());
      }) });
    installPaymentService(service);
    const effects = new FakeEffects(await createNorthfieldRepository());
    const seats: Seat[] = ['collections', 'payables', 'vendor_onboarding'];
    const workers = seats.map(seat => new SeatWorker({ id: `demo:worker:${seat}`, seat, store: state, effects }));
    await Promise.all(workers.map(worker => worker.start()));
    const signal = abort.signal;
    jobs = workers.map((worker, index) => (async () => {
      let pulseAt = 0;
      while (!signal.aborted) {
        const turn = async () => {
          if (Date.now() >= pulseAt) { await worker.pulse(); pulseAt = Date.now() + 3000; }
          await worker.tick(signal);
        };
        // The reconciliation host and collection worker share one claim queue.
        // Serialize the complete claim/reconcile turn so a worker cannot steal its lease.
        if (seats[index] === 'collections') await collections(turn); else await turn();
        await delay(100, undefined, { signal });
      }
    })().catch(() => { if (!signal.aborted) { failed = true; abort.abort(); } }));
  }
  await reset();
  return { reset, stop, health: () => services.health(),
    clientStopped: () => gatewayStore.clientStopped('northfield-jordan'),
    registerVoiceCall: async (sessionId: string) => {
      // Trusted synthetic invoice only. HTTP cannot supply identity, plans or amounts.
      if (!/^[a-f0-9-]{36}$/.test(sessionId)) throw new Error('INVALID_SESSION');
      if (await gatewayStore.clientStopped('northfield-jordan')) throw new Error('CLIENT_STOPPED');
      const invoice = northfield.arInvoices.find(row => row.id === '1042')!;
      await gatewayStore.registerCall({ callId: sessionId, agentId: 'voice:collections', invoiceId: invoice.id,
        clientId: 'northfield-jordan', contactName: 'Jordan', companyName: northfield.company.name,
        amountCents: invoice.principalCents + invoice.lateFeeCents,
        receivable: { principalCents: invoice.principalCents, lateFeeCents: invoice.lateFeeCents },
        currency: 'USD', policyVersion: (await getStateStore().getPolicy()).policyVersion, scenarioSource: 'judge',
        identityConfirmed: false, status: 'active', audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {} });
    }, check: () => getStateStore().getPolicy(), status: (): DemoStatus => ({
    llmEnabled: getStateStore().llmEnabled, stateStore: mode, voice: process.env.DEMO_VOICE_RUNNING === '1',
    workersHealthy: !failed && !abort.signal.aborted, ...services.status(), ...paths,
  }) };
}
