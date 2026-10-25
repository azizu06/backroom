/** Trusted, opt-in local rehearsal host. Never imported by normal Next bootstrap. */
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { MemoryStateStore, SpacetimeStateStore, SpacetimeTransport, type SpacetimeOptions, installStateStore, getStateStore, SeatWorker, FakeEffects,
  northfield, createNorthfieldRepository, PaymentService, mirrorBankFeed, type Seat, type InvoiceState } from '@backroom/orchestrator';
import { MemoryHandoffStore, SpacetimeHandoffStore } from '@backroom/orchestrator/agents';
import { installInboxAgents, narrateCallOutcome, narrateCallRefusal, resetInboxAgents, type CallOutcomeHost } from './agents';
import { createDemoServices, installDemoServiceStatus } from './services';
import { installPrecallEvidence } from '../calls/precall';
import { installCallRefusalFollowUp, installEmailOnlyRefusal } from '../calls/runtime';
import { installCallHandoffs, resolveCallEscalation } from '../calls/handoffs';
import { createVoicePresence } from '../calls/presence';
import { createGateway } from '../gateway/http';
import { installGatewayStore } from '../gateway/runtime';
import { MemoryGatewayStore, type GatewayCall } from '../gateway/store';
import { createApprovalBridge } from '../approvals/gateway';
import { authorizedPaymentLink } from '../payments/authorization';
import { installPaymentService } from '../payments/runtime';
import { recoverDemoPayments, selectRecoverableLinkIds } from './recover-payments';
import type { DemoStatus } from '../../../tools/demo/health';

export async function createDemoRuntime() {
  let services = await createDemoServices();
  installDemoServiceStatus(() => services.status().services);
  installPrecallEvidence(() => services.precall());
  const mode = process.env.STATE_STORE === 'spacetime' ? 'spacetime' : 'memory';
  let config: SpacetimeOptions = { uri: process.env.SPACETIMEDB_URI || '', database: process.env.SPACETIMEDB_DATABASE || '', token: process.env.SPACETIMEDB_TOKEN || '' };
  let abort = new AbortController();
  let jobs: Promise<void>[] = [];
  let paths: Pick<DemoStatus, 'approvePath' | 'payPath'> = {};
  let failed = false;
  let gatewayStore: MemoryGatewayStore;
  let collectionTail = Promise.resolve();
  let retryTimer: ReturnType<typeof setInterval> | undefined;
  let retryEpoch = 0;
  const RETRY_MS = 5_000;
  function disarmRetry() {
    retryEpoch += 1;
    if (retryTimer !== undefined) clearInterval(retryTimer);
    retryTimer = undefined;
  }
  /** One pending-reconciliation sweep at a time. A failure is logged and the host stays up. */
  function armRetry(service: PaymentService) {
    disarmRetry();
    const epoch = retryEpoch;
    let active = false;
    retryTimer = setInterval(() => {
      if (epoch !== retryEpoch || active) return;
      active = true;
      void service.retryPending().catch(error => {
        console.error('demo pending reconciliation retry failed', error);
      }).finally(() => { active = false; });
    }, RETRY_MS);
  }
  async function holdCollections(): Promise<() => void> {
    const prior = collectionTail; let release!: () => void;
    collectionTail = new Promise<void>(resolve => { release = resolve; });
    await prior; return release;
  }
  async function collections<T>(work: () => Promise<T>): Promise<T> {
    const release = await holdCollections();
    try { return await work(); } finally { release(); }
  }
  const presence = createVoicePresence(() => getStateStore());
  let payments: PaymentService | undefined;
  /** The agent reconciler shares the collection claim queue; it holds it for its whole activation. */
  const leaseCollections: CallOutcomeHost['lease'] = async (invoiceId, key) => {
    const unlock = await holdCollections();
    const state = getStateStore(), agent = 'demo:agent-reconciler', id = `demo:agent-reconcile:${key}`;
    try {
      if (!await state.getAgent(agent)) await state.registerAgent(agent, 'collections', Date.now());
      await state.heartbeat(agent, Date.now());
      await state.enqueueTask({ id, seatId: 'collections', refs: [invoiceId], idempotencyKey: `ar:${invoiceId}:1`, steps: [] });
      const lease = await state.claimTask(agent, Date.now(), 60_000);
      if (lease?.id !== id) throw new Error('DEMO_RECONCILIATION_LEASE');
      const pulse = setInterval(() => {
        void state.heartbeat(agent, Date.now()).then(() => state.renewLease(lease, Date.now(), 60_000))
          .catch(error => console.error('agent reconciler lease renewal failed', error));
      }, 5_000);
      pulse.unref();
      let released = false;
      return { lease, async release() {
        if (released) return;
        released = true; clearInterval(pulse);
        try { await state.completeTask(lease, 'done', Date.now()); } finally { unlock(); }
      } };
    } catch (error) { unlock(); throw error; }
  };
  async function stop() {
    disarmRetry(); installCallRefusalFollowUp(undefined); installEmailOnlyRefusal(undefined); installCallHandoffs(undefined);
    presence.stop(); await resetInboxAgents();
    abort.abort(); await Promise.all(jobs); jobs = [];
  }
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
    // One handoff store per state: the role agents and live-call escalations share its sequence and office table.
    const handoffs = transport ? new SpacetimeHandoffStore(transport) : new MemoryHandoffStore({ audit: state });
    const callOutcomes: CallOutcomeHost = { bank: services.bank, accountId: services.accountId, payments: () => payments,
      read: callId => gatewayStore.transact(callId, call => structuredClone(call)).catch(() => undefined), lease: leaseCollections };
    installInboxAgents(state, transport, services.collectionsPlanner(state), { store: handoffs, callOutcomes });
    installCallRefusalFollowUp(entry => entry.outcome === 'refused'
      ? narrateCallRefusal({ outcome: 'refused', code: entry.code, ...(entry.detail ? { detail: entry.detail } : {}) })
      : Promise.resolve(undefined));
    installEmailOnlyRefusal(scenario => services.emailOnlyRefusal(state, scenario));
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
    // Live calls from here on publish their escalations to Dana; the scripted seed above stays as before.
    installCallHandoffs(handoffs);
    // Advance the scripted ALLOW to promised using the same reducer path as the core demo.
    const bookkeeper = 'demo:reconcile';
    await state.registerAgent(bookkeeper, 'collections', Date.now());
    await state.enqueueTask({ id: 'demo:promise:1042', seatId: 'collections', refs: [invoice.id], steps: [] });
    const promiseLease = await state.claimTask(bookkeeper, Date.now(), 12000);
    if (!promiseLease) throw new Error('DEMO_PROMISE_LEASE');
    await state.transitionInvoice(promiseLease, invoice.id, 'overdue', 'in_collection', Date.now());
    await state.transitionInvoice(promiseLease, invoice.id, 'in_collection', 'promised', Date.now());
    await state.completeTask(promiseLease, 'done', Date.now());
    const mirrorFeed = () => mirrorBankFeed(services.bank, state, services.accountId).catch(error => {
      console.error('demo bank feed mirror failed', error);
    });
    const service: PaymentService = new PaymentService({ bank: services.bank, accountId: services.accountId,
      lookup: async id => { const stored = await gatewayStore.findPaymentCall(id); return stored && authorizedPaymentLink(stored, id); },
      onPosted: id => collections(async () => {
        // After the pay posts, and again after reconcile. `recorded` also counts replays, so nothing rings from it.
        await mirrorFeed();
        const agent = 'demo:reconcile';
        await state.heartbeat(agent, Date.now());
        await state.enqueueTask({ id: `demo:reconcile:${id}`, seatId: 'collections', refs: [invoice.id], idempotencyKey: `ar:${invoice.id}:1`, steps: [] });
        const lease = await state.claimTask(agent, Date.now(), 12000);
        if (!lease) throw new Error('DEMO_RECONCILIATION_LEASE');
        await service.reconcile(id, state, lease, 'promised');
        await mirrorFeed();
        await state.completeTask(lease, 'done', Date.now());
      }) });
    installPaymentService(service);
    payments = service;
    // Recover before the 5s sweep so a deposit with no receipt is already pending.
    // Link ids were minted above. A memo deposit that already existed belongs to an older id.
    try {
      const prior = await services.bank.listDeposits(services.accountId);
      const call = await gatewayStore.activePaymentCall();
      const links = call ? call.links.map(row => ({ id: row.id, invoiceId: call.invoiceId, installment: 1 })) : [];
      const decision = selectRecoverableLinkIds(links, prior, links.map(row => row.id));
      for (const skipped of decision.skipped) console.error('demo payment recovery skipped', skipped);
      await recoverDemoPayments(service, decision.ids, state);
    } catch (error) {
      console.error('demo payment recovery failed', error);
    }
    armRetry(service);
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
    endVoiceCall: async (sessionId: string) => {
      if (!/^[a-f0-9-]{36}$/.test(sessionId)) throw new Error('INVALID_SESSION');
      const state = getStateStore();
      await state.expireEscalations(Date.now(), sessionId);
      // Office display and narration only: none of these can fail or delay the recorded call end.
      await presence.end(sessionId).catch(error => console.error('voice presence end failed', error));
      const call = await gatewayStore.transact(sessionId, row => structuredClone(row)).catch(() => undefined);
      for (const escalation of call?.escalations ?? []) {
        await state.getEscalation(escalation.id).then(resolveCallEscalation)
          .catch(error => console.error('call escalation handoff resolve failed', error));
      }
      if (call) void narrateCallOutcome(sessionId).catch(error => console.error('call outcome narration failed', error));
    },
    voiceCallEvent: async (sessionId: string, event: 'started' | 'completed' | 'failed') => {
      if (event !== 'started') await presence.end(sessionId).catch(error => console.error('voice presence end failed', error));
    },
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
      await presence.start(sessionId).catch(error => console.error('voice presence start failed', error));
    }, check: () => getStateStore().getPolicy(), status: (): DemoStatus => ({
    llmEnabled: getStateStore().llmEnabled, stateStore: mode, voice: process.env.DEMO_VOICE_RUNNING === '1',
    workersHealthy: !failed && !abort.signal.aborted, ...services.status(), ...paths,
  }) };
}
