import { createHash } from 'node:crypto';
import type { Effects } from './effects';
import { evaluateStep, type PolicyEvaluator } from './policy-gate';
import type { Lease, Seat, StateStore, Step } from './store';

export interface WorkerOptions {
  id: string; seat: Seat; store: StateStore; effects: Effects; now?: () => number;
  evaluate?: PolicyEvaluator; leaseMs?: number; heartbeatMs?: number;
}
export class SeatWorker {
  private lease?: Lease;
  private busy = false;
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  constructor(private readonly options: WorkerOptions) {
    this.now = options.now ?? Date.now;
    this.leaseMs = options.leaseMs ?? 12000;
    this.heartbeatMs = options.heartbeatMs ?? 3000;
    if (this.heartbeatMs <= 0 || this.heartbeatMs >= 15000 || this.leaseMs <= this.heartbeatMs) {
      throw new Error('INVALID_LEASE_TIMING');
    }
  }
  async start() { await this.options.store.registerAgent(this.options.id, this.options.seat, this.now()); }
  async pulse() {
    await this.options.store.heartbeat(this.options.id, this.now());
    const lease = this.lease;
    if (lease) {
      try { await this.options.store.renewLease(lease, this.now(), this.leaseMs); }
      catch (error) {
        // Async adapters can observe completeTask before an earlier renewal arrives.
        const task = await this.options.store.getTask(lease.id);
        if (!task || task.leaseToken !== lease.leaseToken ||
          !['done', 'denied', 'failed'].includes(task.status)) throw error;
      }
    }
    await this.options.store.reapExpired(this.now());
  }
  /** One deterministic work turn; timers live only in run(). */
  async tick(signal?: AbortSignal): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const { store, effects, id, seat } = this.options;
    try {
      signal?.throwIfAborted();
      this.lease ??= await store.claimTask(id, this.now(), this.leaseMs);
      const lease = this.lease;
      if (!lease) return;
      await store.assertLease(lease, this.now());
      const task = (await store.getTask(lease.id))!;
      if (task.escalationId) {
        // Controller approval never grants blanket permission to replay the effect.
        // A subsequent action must be a new policy-checked task from the controller service.
        const escalation = await store.getEscalation(task.escalationId);
        if (!escalation) throw new Error('ESCALATION_NOT_FOUND');
        if (escalation?.status === 'pending') {
          if ((await store.getAgent(id))?.state === 'working') {
            await store.setAgentTarget(lease, `${escalation.toHuman}_desk`, this.now()); return;
          }
          await store.setAgentState(lease, 'waiting', this.now()); return;
        }
        await store.completeTask(lease, escalation?.status === 'approved' ? 'done' : 'denied', this.now());
        this.lease = undefined; return;
      }
      const step = task.steps[task.cursor];
      if (!step) { await store.completeTask(lease, 'done', this.now()); this.lease = undefined; return; }
      const decision = (this.options.evaluate ?? evaluateStep)(seat, step);
      await store.appendAudit({ ts: this.now(), actor: 'code', seat, action: step.action.type,
        ruleIds: decision.ruleIds, policyVersion: decision.policyVersion, refs: task.refs,
        route: 'code', decision: decision.kind, latencyMs: 0, costUsd: 0 });
      if (decision.kind === 'DENY') {
        await store.completeTask(lease, 'denied', this.now()); this.lease = undefined; return;
      }
      if (decision.kind === 'ESCALATE') {
        await store.createEscalation(lease, decision, this.now());
        await store.setAgentTarget(lease, `${decision.toHuman}_desk`, this.now()); return;
      }
      const fingerprint = paymentFingerprint(step);
      const prior = step.kind === 'nessie'
        ? await store.reservePayment(lease, task.idempotencyKey!, fingerprint, this.now()) : undefined;
      await store.assertLease(lease, this.now());
      signal?.throwIfAborted();
      if (step.kind === 'dial') await store.setAgentState(lease, 'on_call', this.now());
      const result = step.kind === 'nessie' && prior ? prior.result : await effects[step.kind]({
        input: step.input, idempotencyKey: step.kind === 'nessie' ? task.idempotencyKey : undefined, signal });
      if (step.kind === 'nessie') await store.recordPayment(lease,
        { key: task.idempotencyKey!, fingerprint, result }, this.now());
      await store.appendAudit({ ts: this.now(), actor: 'system', seat, action: `${step.kind}_completed`,
        ruleIds: decision.ruleIds, policyVersion: decision.policyVersion, refs: task.refs,
        route: 'external', latencyMs: 0, costUsd: 0 });
      await store.advanceTask(lease, this.now());
      if (task.cursor + 1 === task.steps.length) {
        await store.completeTask(lease, 'done', this.now()); this.lease = undefined;
      } else await store.setAgentState(lease, 'working', this.now());
    } finally { this.busy = false; }
  }
  /** Heartbeats continue while an external request is outstanding. Failures stop this worker;
   * replacement agents recover persisted cursor + lease once expired. No hidden retry loop.
   */
  async run(signal: AbortSignal): Promise<void> {
    await this.start();
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', forwardAbort, { once: true });
    if (signal.aborted) forwardAbort();
    let pulseError: unknown;
    let pulseRunning = false;
    const timer = setInterval(() => {
      if (pulseRunning) return;
      pulseRunning = true;
      void this.pulse().catch(error => { pulseError = error; controller.abort(error); })
        .finally(() => { pulseRunning = false; });
    }, this.heartbeatMs);
    try {
      while (!controller.signal.aborted) {
        await this.tick(controller.signal);
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timeout); controller.signal.removeEventListener('abort', finish); resolve(); };
          const timeout = setTimeout(finish, 100);
          controller.signal.addEventListener('abort', finish, { once: true });
          if (controller.signal.aborted) finish();
        });
      }
      if (pulseError) throw pulseError;
    } catch (error) { if (!signal.aborted || pulseError) throw error; }
    finally { clearInterval(timer); signal.removeEventListener('abort', forwardAbort); }
  }
}
function paymentFingerprint(step: Step): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return createHash('sha256').update(JSON.stringify(canonical(step.input))).digest('hex');
}
