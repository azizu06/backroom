import { MemoryFinanceRepository } from '../payables/repository';
import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { FakeEffects, MemoryStateStore, type AuditEntry, type NewTask, type Task } from '../index';

export type KillPoint = 'before_payment' | 'after_payment' | 'after_receipt' | 'after_cursor';
export interface RecoveryOptions {
  batchSize?: number; killAfter?: number; kills?: number; killPoint?: KillPoint;
  leaseMs?: number; heartbeatMs?: number; timeoutMs?: number;
  log?: (text: string) => void;
}
export interface RecoveryResult {
  before: AuditEntry[][]; after: AuditEntry[]; tasks: Task[];
  payments: number; kills: number; signals: (NodeJS.Signals | null)[];
}
interface Request { id: number; target: 'store' | 'effects'; method: string; args: unknown[] }
const storeMethods = new Set(['registerAgent', 'getAgent', 'heartbeat', 'claimTask', 'renewLease',
  'assertLease', 'reapExpired', 'getTask', 'setAgentState', 'setAgentTarget', 'advanceTask',
  'completeTask', 'getEscalation', 'createEscalation', 'appendAudit', 'listAudit',
  'getPayment', 'reservePayment', 'recordPayment']);
const killMethods: Record<KillPoint, string> = {
  before_payment: 'reservePayment', after_payment: 'nessie',
  after_receipt: 'recordPayment', after_cursor: 'advanceTask',
};
export function paymentTask(index: number): NewTask {
  const id = `recovery:${index}`;
  return { id, seatId: 'payables', refs: [`invoice:${id}`], idempotencyKey: `${id}:payment`,
    steps: [{ kind: 'nessie', action: { type: 'pay_invoice' }, context: { policyVersion: 1,
      vendor: { id: 'vendor:recovery', inMaster: true, approved: true,
        pendingBankChange: false, knownDomain: 'example.com' } },
    input: { invoice: { id: `invoice:${id}`, vendorId: 'vendor:recovery', amountCents: 5000,
      poMatched: true, account: 'operating',
      lineItems: [{ description: `Service ${index}`, quantity: 1, unitPriceCents: 5000 }] } } }],
  };
}

/** No network/model calls. The parent represents independently surviving state/provider services.
 * This proves worker-process recovery, not survival of a state-service or provider restart.
 */
export async function runRecovery(options: RecoveryOptions = {}): Promise<RecoveryResult> {
  const { batchSize = 4, killAfter = 2, kills = 1, killPoint = 'after_payment',
    leaseMs = 1200, heartbeatMs = 200, timeoutMs = 15000, log = () => {} } = options;
  if (![batchSize, killAfter, kills, leaseMs, heartbeatMs, timeoutMs].every(Number.isSafeInteger) ||
    batchSize < 1 || killAfter < 1 || kills < 1 || killAfter + kills - 1 > batchSize ||
    heartbeatMs <= 0 || heartbeatMs >= 15000 || leaseMs <= heartbeatMs || timeoutMs <= leaseMs ||
    !Object.hasOwn(killMethods, killPoint)) throw new Error('INVALID_RECOVERY_OPTIONS');
  const store = new MemoryStateStore();
  // This demo runs only deterministic payments; keep models OFF for its entire lifetime.
  await store.setLlmEnabled(false);
  const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [{ id: 'vendor:recovery', domain: 'example.com', accountId: 'approved-bank', approved: true, revision: 1 }] }));
  const batch = Array.from({ length: batchSize }, (_, index) => paymentTask(index + 1));
  for (const task of batch) await store.enqueueTask(task);
  const before: AuditEntry[][] = [];
  const signals: (NodeJS.Signals | null)[] = [];
  let killed = 0;
  let serviceError: unknown;
  let child: ChildProcess | undefined;
  let exited: Promise<void> = Promise.resolve();
  let alive = false;
  const spawnWorker = (generation: number) => {
    const process = fork(new URL('./worker-process.ts', import.meta.url),
      [`payables:${generation}`, String(leaseMs), String(heartbeatMs)],
      { execArgv: ['--import', createRequire(import.meta.url).resolve('tsx')], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    child = process; alive = true;
    let stderr = '';
    process.stderr!.on('data', data => { stderr += String(data); });
    exited = new Promise<void>(resolve => {
      process.once('error', error => { serviceError = error; alive = false; resolve(); });
      process.once('exit', (code, signal) => {
        alive = false; signals.push(signal);
        if (code !== 0 && signal !== 'SIGKILL') serviceError = new Error(`WORKER_EXIT: ${code}: ${stderr}`);
        resolve();
      });
    });
    process.on('message', (request: Request) => {
      void (async () => {
        if (!Number.isSafeInteger(request.id) || !Array.isArray(request.args) ||
          !(request.target === 'store' ? storeMethods.has(request.method)
            : request.target === 'effects' && request.method === 'nessie')) throw new Error('INVALID_RPC');
        const target = request.target === 'store' ? store : effects;
        const method = (target as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[request.method]!;
        const result = await method.apply(target, request.args);
        // Pause after the service committed, before the worker receives its result.
        // This makes every crash window deterministic without a test hook in SeatWorker.
        const arg = request.args[0] as { id?: string; input?: { invoice?: { id?: string } } };
        const taskId = request.target === 'store' ? arg?.id : arg?.input?.invoice?.id?.replace(/^invoice:/, '');
        if (killed < kills && request.method === killMethods[killPoint] && taskId === `recovery:${killAfter + killed}`) {
          before.push(await store.listAudit());
          log(`BEFORE SIGKILL worker=${process.pid} task=${taskId} point=${killPoint}\n${JSON.stringify(before.at(-1), null, 2)}`);
          killed++;
          if (!process.kill('SIGKILL')) throw new Error('SIGKILL_FAILED');
          return;
        }
        if (process.connected) process.send({ id: request.id, result }, error => {
          if (error && !process.killed) serviceError = error;
        });
      })().catch(error => {
        serviceError = error;
        if (process.connected) process.send({ id: request.id, error: error instanceof Error ? error.message : String(error) }, () => {});
      });
    });
  };
  const deadline = Date.now() + timeoutMs;
  try {
    spawnWorker(1);
    while (true) {
      if (serviceError) throw serviceError;
      if (Date.now() >= deadline) throw new Error('RECOVERY_TIMEOUT');
      const tasks = await Promise.all(batch.map(task => store.getTask(task.id)));
      if (tasks.every(task => task?.status === 'done')) break;
      if (!alive) { await exited; spawnWorker(killed + 1); }
      await delay(20);
    }
    const tasks = await Promise.all(batch.map(task => store.getTask(task.id)));
    const after = await store.listAudit();
    const expired = after.filter(entry => entry.action === 'lease_expired');
    const resumed = after.filter(entry => entry.action === 'task_resumed');
    const uniqueKeys = new Set(effects.calls.map(call => call.idempotencyKey));
    if (killed !== kills || expired.length !== kills || resumed.length !== kills ||
      effects.calls.length !== batchSize || uniqueKeys.size !== batchSize ||
      tasks.some(task => task?.status !== 'done' || task.leaseOwner || task.leaseExpiresAt)) {
      throw new Error('RECOVERY_INVARIANT_FAILED');
    }
    log(`AFTER RECOVERY\n${JSON.stringify(after, null, 2)}`);
    log(`PASS recovery: ${batchSize} tasks done, ${effects.calls.length} simulated payments, ${killed} SIGKILL(s), 0 duplicates, 0 stranded leases`);
    return { before, after, tasks: tasks as Task[], payments: effects.calls.length, kills: killed, signals };
  } finally {
    if (child && alive) child.kill('SIGTERM');
    await exited;
  }
}
