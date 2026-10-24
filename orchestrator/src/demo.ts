import { FakeEffects, MemoryStateStore, SeatWorker, type NewTask, type Seat } from './index';

const store = new MemoryStateStore();
const effects = new FakeEffects();
const seats: Seat[] = ['collections', 'payables', 'vendor_onboarding'];
const tasks: NewTask[] = [
  { id: 'demo:collections', seatId: 'collections', refs: ['ar:demo'], steps: [
    { kind: 'dial', action: { type: 'call_client' }, context: { policyVersion: 1 }, input: { clientId: 'demo-client' } },
  ] },
  { id: 'demo:payables', seatId: 'payables', refs: ['ap:demo'], idempotencyKey: 'ap:demo:payment:1', steps: [
    { kind: 'nessie', action: { type: 'pay_invoice' }, context: { policyVersion: 1 },
      input: { invoiceId: 'ap:demo', amountCents: 5000, accountId: 'approved-demo-account' } },
  ] },
  { id: 'demo:vendor', seatId: 'vendor_onboarding', refs: ['vendor:demo'], steps: [
    { kind: 'crs', action: { type: 'run_crs' }, context: { policyVersion: 1 }, input: { vendorId: 'vendor:demo' } },
    { kind: 'apify', action: { type: 'run_apify' }, context: { policyVersion: 1 }, input: { domain: 'example.com' } },
  ] },
];
const workers = seats.map(seat => new SeatWorker({ id: `demo:${seat}`, seat, store, effects }));
for (const worker of workers) await worker.start();
for (const task of tasks) await store.enqueueTask(task);
for (let turn = 0; turn < 3; turn++) await Promise.all(workers.map(worker => worker.tick()));
console.log(JSON.stringify({ simulatedEffects: true, policy: '@backroom/policy (stub denies all until #11)',
  agents: await Promise.all(seats.map(seat => store.getAgent(`demo:${seat}`))),
  tasks: await Promise.all(tasks.map(task => store.getTask(task.id))), audit: await store.listAudit() }, null, 2));
