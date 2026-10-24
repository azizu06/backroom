import { canonicalAuditJson } from './audit';
import { randomUUID } from 'node:crypto';
import { DbConnection } from './spacetime-client';
import { consumeVerifiedApproval, type VerifiedApproval } from './approvals/verified';
import type { ReducerEngine } from './reducer-engine';
import type { StateStore } from './store';
import { bankTxnPayload, type BankTxnRow } from './payments/bank-feed';

export interface ControlSnapshot { enabled: boolean; generation: bigint; connected: boolean }
/** Network seam; offline tests drive the real reducers through the WASM harness. */
export interface StateTransport {
  ready: Promise<void>;
  invoke(method: string, values: unknown[]): Promise<unknown>;
  recordBankTxn?(row: BankTxnRow): Promise<void>;
  onControl(listener: (control: ControlSnapshot) => void): () => void;
  close(): void;
}
export interface SpacetimeOptions { uri: string; database: string; token: string; timeoutMs?: number }

export class SpacetimeTransport implements StateTransport {
  readonly ready: Promise<void>;
  private connection!: DbConnection;
  private listeners = new Set<(control: ControlSnapshot) => void>();
  private snapshot: ControlSnapshot = { enabled: false, generation: 0n, connected: false };
  private pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  private timer?: ReturnType<typeof setInterval>;
  private lastUpdate = 0;
  private closed = false;
  private authorized = false;
  private readonly timeoutMs: number;
  constructor(options: SpacetimeOptions) {
    if (!options.uri || !options.database || !options.token) throw new Error('SPACETIME_CONFIG_REQUIRED');
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.ready = new Promise<void>((resolve, reject) => {
      const startup = setTimeout(() => { this.failClosed(); reject(new Error('SPACETIME_CONNECT_TIMEOUT')); this.close(); }, this.timeoutMs);
      this.connection = DbConnection.builder().withUri(options.uri).withDatabaseName(options.database).withToken(options.token)
        .onConnect(connection => {
          connection.db.runtimeControl.onInsert((_ctx, row) => this.control(row));
          connection.db.runtimeControl.onUpdate((_ctx, _old, row) => this.control(row));
          connection.db.serverResults.onInsert((_ctx, row) => {
            const waiter = this.pending.get(row.id);
            if (waiter) waiter.resolve(JSON.parse(row.result).value ?? undefined);
          });
          connection.subscriptionBuilder().onApplied(() => {
            void connection.reducers.syncControl({}).then(() => {
              this.authorized = true;
              clearTimeout(startup);
              const row = connection.db.runtimeControl.id.find('global');
              if (!row) { this.failClosed(); reject(new Error('RUNTIME_CONTROL_MISSING')); return; }
              this.control(row);
              this.timer = setInterval(() => {
                if (Date.now() - this.lastUpdate > this.timeoutMs) this.failClosed();
                void connection.reducers.syncControl({}).catch(() => this.failClosed());
              }, 1000);
              this.timer.unref();
              resolve();
            }).catch(() => { clearTimeout(startup); this.failClosed(); reject(new Error('SPACETIME_WRITER_REQUIRED')); });
          }).onError(() => { clearTimeout(startup); this.failClosed(); reject(new Error('SPACETIME_SUBSCRIPTION_FAILED')); })
            .subscribe(['SELECT * FROM runtime_control', 'SELECT * FROM server_results']);
        })
        .onConnectError(() => { clearTimeout(startup); this.failClosed(); reject(new Error('SPACETIME_CONNECT_FAILED')); })
        .onDisconnect(() => { clearTimeout(startup); this.failClosed(); reject(new Error('SPACETIME_DISCONNECTED')); })
        .build();
    });
    // Synchronous runtime bootstrap may construct this before the first request.
    void this.ready.catch(() => {});
  }
  private control(row: { llmEnabled: boolean; generation: bigint }) {
    if (this.closed) return;
    this.lastUpdate = Date.now();
    this.snapshot = { enabled: row.llmEnabled, generation: row.generation, connected: this.authorized };
    for (const listener of this.listeners) listener(this.snapshot);
  }
  private failClosed() {
    this.snapshot = { ...this.snapshot, connected: false };
    for (const listener of this.listeners) listener(this.snapshot);
    for (const waiter of this.pending.values()) waiter.reject(new Error('SPACETIME_DISCONNECTED'));
    this.pending.clear();
  }
  onControl(listener: (control: ControlSnapshot) => void) {
    this.listeners.add(listener); listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }
  async invoke(method: string, values: unknown[]): Promise<unknown> {
    await this.ready;
    if (!this.snapshot.connected || !this.connection.isActive) throw new Error('SPACETIME_DISCONNECTED');
    const reducer = this.connection.reducers[method as keyof typeof this.connection.reducers] as
      (args: { requestId: string; payload: string }) => Promise<void>;
    if (typeof reducer !== 'function') throw new Error('UNKNOWN_STATE_REDUCER');
    const requestId = randomUUID();
    let timeout: ReturnType<typeof setTimeout>;
    const result = new Promise<unknown>((resolve, reject) => {
      timeout = setTimeout(() => { this.failClosed(); reject(new Error('SPACETIME_REDUCER_TIMEOUT')); }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject });
    });
    void reducer({ requestId, payload: JSON.stringify(values) }).catch(error => this.pending.get(requestId)?.reject(error));
    try { return await result; }
    finally {
      clearTimeout(timeout!); this.pending.delete(requestId);
      if (this.connection.isActive) void this.connection.reducers.ackResult({ requestId }).catch(() => {});
    }
  }
  async seedCompany(seed: unknown) { await this.ready; await this.connection.reducers.seedCompany({ payload: JSON.stringify(seed) }); }
  async recordBankTxn(row: BankTxnRow): Promise<void> {
    await this.ready;
    await this.connection.reducers.recordBankTxn({ payload: bankTxnPayload(row) });
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.failClosed(); this.connection?.disconnect();
  }
}

/** Durable StateStore: all reads/writes run on the authoritative server. Caller
 * time arguments satisfy the common interface but reducers replace them with DB time.
 */
export class SpacetimeStateStore implements StateStore {
  readonly ready: Promise<void>;
  private readonly transport: StateTransport;
  private controller = new AbortController();
  private enabled = false;
  private generation?: bigint;
  private unsubscribe: () => void;
  constructor(options: SpacetimeOptions | { transport: StateTransport }) {
    this.controller.abort('SPACETIME_NOT_READY');
    this.transport = 'transport' in options ? options.transport : new SpacetimeTransport(options);
    this.ready = this.transport.ready;
    this.unsubscribe = this.transport.onControl(control => {
      const enabled = control.connected && control.enabled;
      if (!enabled || this.generation !== control.generation) this.controller.abort(enabled ? 'LLM_GENERATION_CHANGED' : 'LLM_OFF_OR_DISCONNECTED');
      if (enabled && this.controller.signal.aborted) this.controller = new AbortController();
      this.enabled = enabled; this.generation = control.generation;
    });
  }
  get llmEnabled() { return this.enabled; }
  get llmSignal() { return this.controller.signal; }
  async recordBankTxn(row: BankTxnRow): Promise<void> {
    await this.ready;
    if (!this.transport.recordBankTxn) throw new Error('BANK_TXN_TRANSPORT_REQUIRED');
    await this.transport.recordBankTxn(row);
  }
  async close() { this.unsubscribe(); this.enabled = false; this.controller.abort('SPACETIME_CLOSED'); this.transport.close(); }
  private async call<K extends keyof StateStore>(method: string, values: unknown[]): Promise<Awaited<ReturnType<Extract<StateStore[K], (...args: never[]) => unknown>>>> {
    const wire = [...values];
    while (wire.length && wire.at(-1) === undefined) wire.pop();
    return await this.transport.invoke(method, JSON.parse(canonicalAuditJson(wire))) as Awaited<ReturnType<Extract<StateStore[K], (...args: never[]) => unknown>>>;
  }
  async decideEscalation(approval: VerifiedApproval, now: number) {
    return this.call<'decideEscalation'>('decideEscalation', [consumeVerifiedApproval(approval), now]);
  }
  async setLlmEnabled(...args: [enabled: boolean]) { return this.call<'setLlmEnabled'>('setLlmEnabled', args); }
  async getPolicy(...args: Parameters<ReducerEngine['getPolicy']>) { return this.call<'getPolicy'>('getPolicy', args); }
  async savePolicyLimits(...args: Parameters<ReducerEngine['savePolicyLimits']>) { return this.call<'savePolicyLimits'>('savePolicyLimits', args); }
  async registerAgent(...args: Parameters<ReducerEngine['registerAgent']>) { return this.call<'registerAgent'>('registerAgent', args); }
  async getAgent(...args: Parameters<ReducerEngine['getAgent']>) { return this.call<'getAgent'>('getAgent', args); }
  async getTask(...args: Parameters<ReducerEngine['getTask']>) { return this.call<'getTask'>('getTask', args); }
  async heartbeat(...args: Parameters<ReducerEngine['heartbeat']>) { return this.call<'heartbeat'>('heartbeat', args); }
  async enqueueTask(...args: Parameters<ReducerEngine['enqueueTask']>) { return this.call<'enqueueTask'>('enqueueTask', args); }
  async claimTask(...args: Parameters<ReducerEngine['claimTask']>) { return this.call<'claimTask'>('claimTask', args); }
  async assertLease(...args: Parameters<ReducerEngine['assertLease']>) { return this.call<'assertLease'>('assertLease', args); }
  async renewLease(...args: Parameters<ReducerEngine['renewLease']>) { return this.call<'renewLease'>('renewLease', args); }
  async reapExpired(...args: Parameters<ReducerEngine['reapExpired']>) { return this.call<'reapExpired'>('reapExpired', args); }
  async setAgentState(...args: Parameters<ReducerEngine['setAgentState']>) { return this.call<'setAgentState'>('setAgentState', args); }
  async setAgentTarget(...args: Parameters<ReducerEngine['setAgentTarget']>) { return this.call<'setAgentTarget'>('setAgentTargetLeased', args); }
  async pauseTask(...args: Parameters<ReducerEngine['pauseTask']>) { return this.call<'pauseTask'>('pauseTask', args); }
  async advanceTask(...args: Parameters<ReducerEngine['advanceTask']>) { return this.call<'advanceTask'>('advanceTask', args); }
  async completeTask(...args: Parameters<ReducerEngine['completeTask']>) { return this.call<'completeTask'>('completeTask', args); }
  async createEscalation(...args: Parameters<ReducerEngine['createEscalation']>) { return this.call<'createEscalation'>('createEscalation', args); }
  async createCallEscalation(...args: Parameters<ReducerEngine['createCallEscalation']>) { return this.call<'createCallEscalation'>('createCallEscalation', args); }
  async expireEscalations(...args: Parameters<ReducerEngine['expireEscalations']>) { return this.call<'expireEscalations'>('expireEscalations', args); }
  async getEscalation(...args: Parameters<ReducerEngine['getEscalation']>) { return this.call<'getEscalation'>('getEscalation', args); }
  async appendAudit(...args: Parameters<ReducerEngine['appendAudit']>) { return this.call<'appendAudit'>('appendAudit', args); }
  async appendAudits(...args: Parameters<ReducerEngine['appendAudits']>) { return this.call<'appendAudits'>('appendAudits', args); }
  async listAudit(...args: Parameters<ReducerEngine['listAudit']>) { return this.call<'listAudit'>('listAudit', args); }
  async getAudit(...args: Parameters<ReducerEngine['getAudit']>) { return this.call<'getAudit'>('getAudit', args); }
  async verifyAuditChain(...args: Parameters<ReducerEngine['verifyAuditChain']>) { return this.call<'verifyAuditChain'>('verifyAuditChain', args); }
  async getPayment(...args: Parameters<ReducerEngine['getPayment']>) { return this.call<'getPayment'>('getPayment', args); }
  async reservePayment(...args: Parameters<ReducerEngine['reservePayment']>) { return this.call<'reservePayment'>('reservePayment', args); }
  async recordPayment(...args: Parameters<ReducerEngine['recordPayment']>) { return this.call<'recordPayment'>('recordPayment', args); }
  async insertInvoice(...args: Parameters<ReducerEngine['insertInvoice']>) { return this.call<'insertInvoice'>('insertInvoice', args); }
  async transitionInvoice(...args: Parameters<ReducerEngine['transitionInvoice']>) { return this.call<'transitionInvoice'>('transitionInvoice', args); }
}
