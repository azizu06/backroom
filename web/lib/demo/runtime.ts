/** Trusted, opt-in local rehearsal host. Never imported by normal Next bootstrap. */
import { randomUUID } from 'node:crypto';
import { MemoryStateStore, installStateStore, getStateStore, SeatWorker, FakeEffects,
  northfield, createNorthfieldRepository, PaymentService, type Seat, type InvoiceState } from '@backroom/orchestrator';
import { NessieClient, type Transaction } from '@backroom/nessie';
import { createGateway } from '../gateway/http';
import { installGatewayStore } from '../gateway/runtime';
import { MemoryGatewayStore, type GatewayCall } from '../gateway/store';
import { createApprovalBridge } from '../approvals/gateway';
import { authorizedPaymentLink } from '../payments/authorization';
import { installPaymentService } from '../payments/runtime';
import type { DemoStatus } from '../../../tools/demo/health';

export async function createDemoRuntime() {
  let abort = new AbortController();
  let jobs: Promise<void>[] = [];
  let paths: Pick<DemoStatus, 'approvePath' | 'payPath'> = {};
  let failed = false;
  async function stop() { abort.abort(); await Promise.all(jobs); jobs = []; }
  async function reset() {
    await stop();
    abort = new AbortController(); failed = false;
    const state = new MemoryStateStore();
    await installStateStore(state);
    await state.setLlmEnabled(process.env.DEMO_LLM === 'on');
    for (const invoice of northfield.arInvoices) await state.insertInvoice({ id: invoice.id, kind: 'ar', state: invoice.status as InvoiceState });
    for (const invoice of northfield.apInvoices) await state.insertInvoice({ id: invoice.id, kind: 'ap', state: invoice.status as InvoiceState });
    // This is a preverified synthetic call, never a live caller identity assertion.
    const invoice = northfield.arInvoices.find(row => row.id === '1042')!;
    const call: GatewayCall = { callId: 'demo-collections-1042', agentId: 'demo:collections', invoiceId: invoice.id,
      clientId: invoice.clientId, contactName: 'Jordan', companyName: northfield.company.name,
      amountCents: invoice.principalCents + invoice.lateFeeCents,
      receivable: { principalCents: invoice.principalCents, lateFeeCents: invoice.lateFeeCents },
      currency: 'USD', policyVersion: northfield.policyVersion, identityConfirmed: true,
      status: 'active', audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {} };
    const gatewayStore = new MemoryGatewayStore([call], state);
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
    // No startup/reset bank requests. All external effects in this host are explicitly mock.
    const deposits: Transaction[] = [], claims = new Set<string>();
    const bank = new NessieClient({ apiKey: 'mock-no-network', claims: { async claim(key) {
      if (claims.has(key)) return false; claims.add(key); return true;
    } }, fetch: async (url, init) => {
      if (init?.method === 'POST') {
        const row = { ...JSON.parse(String(init.body)), _id: `mock-deposit-${deposits.length + 1}` };
        deposits.push(row); return Response.json({ objectCreated: row });
      }
      return Response.json(String(url).includes('/deposits') ? deposits : {
        balance: northfield.bankAccounts.find(row => row.id === 'receivables')!.balanceCents / 100 });
    } });
    // Advance the scripted ALLOW to promised using the same reducer path as the core demo.
    const bookkeeper = 'demo:reconcile';
    await state.registerAgent(bookkeeper, 'collections', Date.now());
    await state.enqueueTask({ id: 'demo:promise:1042', seatId: 'collections', refs: [invoice.id], steps: [] });
    const promiseLease = await state.claimTask(bookkeeper, Date.now(), 12000);
    if (!promiseLease) throw new Error('DEMO_PROMISE_LEASE');
    await state.transitionInvoice(promiseLease, invoice.id, 'overdue', 'in_collection', Date.now());
    await state.transitionInvoice(promiseLease, invoice.id, 'in_collection', 'promised', Date.now());
    await state.completeTask(promiseLease, 'done', Date.now());
    const service: PaymentService = new PaymentService({ bank, accountId: 'mock-northfield',
      lookup: async id => { const stored = await gatewayStore.findPaymentCall(id); return stored && authorizedPaymentLink(stored, id); },
      onPosted: async id => {
        const agent = 'demo:reconcile';
        await state.heartbeat(agent, Date.now());
        await state.enqueueTask({ id: `demo:reconcile:${id}`, seatId: 'collections', refs: [invoice.id], idempotencyKey: `ar:${invoice.id}:1`, steps: [] });
        const lease = await state.claimTask(agent, Date.now(), 12000);
        if (!lease) throw new Error('DEMO_RECONCILIATION_LEASE');
        await service.reconcile(id, state, lease, 'promised');
        await state.completeTask(lease, 'done', Date.now());
      } });
    installPaymentService(service);
    const effects = new FakeEffects(await createNorthfieldRepository());
    const seats: Seat[] = ['collections', 'payables', 'vendor_onboarding'];
    const workers = seats.map(seat => new SeatWorker({ id: `demo:worker:${seat}`, seat, store: state, effects }));
    // run() registers immediately; heartbeats stay in this same process.
    jobs = workers.map(worker => worker.run(abort.signal).catch(() => { failed = true; abort.abort(); }));
  }
  await reset();
  return { reset, stop, status: (): DemoStatus & { workersHealthy: boolean; bank: 'mock' } => ({
    llmEnabled: getStateStore().llmEnabled, stateStore: 'memory', voice: process.env.DEMO_VOICE_RUNNING === '1',
    workersHealthy: !failed && !abort.signal.aborted, bank: 'mock', ...paths,
  }) };
}
