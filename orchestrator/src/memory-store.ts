import { consumeVerifiedApproval, type VerifiedApproval } from './approvals/verified';
import { ReducerEngine } from './reducer-engine';
import type { StateStore } from './store';
import { bankTxnPayload, type BankTxnRow } from './payments/bank-feed';
import { signalPayload, type SignalRow } from './collections/signals';
export { hashAudit } from './audit';

/** Process-local adapter over the same deterministic engine used by DB reducers. */
export class MemoryStateStore implements StateStore {
  private readonly engine = new ReducerEngine();
  private readonly bankTxns = new Map<string, string>();
  private readonly signals = new Map<string, string>();
  private modelController = new AbortController();
  async recordBankTxn(row: BankTxnRow): Promise<void> {
    if (!row.nessieId || !Number.isSafeInteger(row.amountCents) || row.amountCents <= 0 || !row.memo) throw new Error('INVALID_BANK_TXN');
    if (row.nessieId.length > 200) throw new Error('INVALID_EVENT_ID');
    const payload = bankTxnPayload(row);
    const prior = this.bankTxns.get(row.nessieId);
    if (prior !== undefined && prior !== payload) throw new Error('EVENT_ID_CONFLICT');
    this.bankTxns.set(row.nessieId, payload);
  }
  async listBankTxns(): Promise<BankTxnRow[]> { return [...this.bankTxns.values()].map(payload => JSON.parse(payload)); }
  async recordSignal(row: SignalRow): Promise<void> {
    if (!row.source || !row.type || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) throw new Error('INVALID_SIGNAL');
    if (!row.id || row.id.length > 200) throw new Error('INVALID_EVENT_ID');
    const payload = signalPayload(row);
    const prior = this.signals.get(row.id);
    if (prior !== undefined && prior !== payload) throw new Error('EVENT_ID_CONFLICT');
    this.signals.set(row.id, payload);
  }
  async listSignals(): Promise<SignalRow[]> { return [...this.signals.values()].map(payload => JSON.parse(payload)); }
  get llmEnabled() { return this.engine.llmEnabled; }
  get llmSignal() { return this.modelController.signal; }
  async setLlmEnabled(enabled: boolean) {
    const before = this.llmEnabled;
    this.engine.setLlmEnabled(enabled, Date.now());
    if (before === enabled) return;
    if (enabled) this.modelController = new AbortController();
    else this.modelController.abort('LLM_OFF');
  }
  async decideEscalation(approval: VerifiedApproval, now: number) {
    return this.engine.decideEscalation(consumeVerifiedApproval(approval), now);
  }
  async getPolicy(...args: Parameters<ReducerEngine['getPolicy']>) { return this.engine.getPolicy(...args); }
  async savePolicyLimits(...args: Parameters<ReducerEngine['savePolicyLimits']>) { return this.engine.savePolicyLimits(...args); }
  async registerAgent(...args: Parameters<ReducerEngine['registerAgent']>) { return this.engine.execute('registerAgent', args); }
  async getAgent(...args: Parameters<ReducerEngine['getAgent']>) { return this.engine.execute('getAgent', args); }
  async getTask(...args: Parameters<ReducerEngine['getTask']>) { return this.engine.execute('getTask', args); }
  async heartbeat(...args: Parameters<ReducerEngine['heartbeat']>) { return this.engine.execute('heartbeat', args); }
  async enqueueTask(...args: Parameters<ReducerEngine['enqueueTask']>) { return this.engine.execute('enqueueTask', args); }
  async claimTask(...args: Parameters<ReducerEngine['claimTask']>) { return this.engine.execute('claimTask', args); }
  async assertLease(...args: Parameters<ReducerEngine['assertLease']>) { return this.engine.execute('assertLease', args); }
  async renewLease(...args: Parameters<ReducerEngine['renewLease']>) { return this.engine.execute('renewLease', args); }
  async reapExpired(...args: Parameters<ReducerEngine['reapExpired']>) { return this.engine.execute('reapExpired', args); }
  async setAgentState(...args: Parameters<ReducerEngine['setAgentState']>) { return this.engine.execute('setAgentState', args); }
  async setAgentTarget(...args: Parameters<ReducerEngine['setAgentTarget']>) { return this.engine.execute('setAgentTarget', args); }
  async pauseTask(...args: Parameters<ReducerEngine['pauseTask']>) { return this.engine.execute('pauseTask', args); }
  async advanceTask(...args: Parameters<ReducerEngine['advanceTask']>) { return this.engine.execute('advanceTask', args); }
  async completeTask(...args: Parameters<ReducerEngine['completeTask']>) { return this.engine.execute('completeTask', args); }
  async createEscalation(...args: Parameters<ReducerEngine['createEscalation']>) { return this.engine.execute('createEscalation', args); }
  async createCallEscalation(...args: Parameters<ReducerEngine['createCallEscalation']>) { return this.engine.execute('createCallEscalation', args); }
  async setCallPresence(...args: Parameters<ReducerEngine['setCallPresence']>) { return this.engine.execute('setCallPresence', args); }
  async expireEscalations(...args: Parameters<ReducerEngine['expireEscalations']>) { return this.engine.execute('expireEscalations', args); }
  async getEscalation(...args: Parameters<ReducerEngine['getEscalation']>) { return this.engine.execute('getEscalation', args); }
  async appendAudit(...args: Parameters<ReducerEngine['appendAudit']>) { return this.engine.execute('appendAudit', args); }
  async appendAudits(...args: Parameters<ReducerEngine['appendAudits']>) { return this.engine.execute('appendAudits', args); }
  async listAudit(...args: Parameters<ReducerEngine['listAudit']>) { return this.engine.execute('listAudit', args); }
  async getAudit(...args: Parameters<ReducerEngine['getAudit']>) { return this.engine.execute('getAudit', args); }
  async verifyAuditChain(...args: Parameters<ReducerEngine['verifyAuditChain']>) { return this.engine.execute('verifyAuditChain', args); }
  async getPayment(...args: Parameters<ReducerEngine['getPayment']>) { return this.engine.execute('getPayment', args); }
  async reservePayment(...args: Parameters<ReducerEngine['reservePayment']>) { return this.engine.execute('reservePayment', args); }
  async recordPayment(...args: Parameters<ReducerEngine['recordPayment']>) { return this.engine.execute('recordPayment', args); }
  async insertInvoice(...args: Parameters<ReducerEngine['insertInvoice']>) { return this.engine.execute('insertInvoice', args); }
  async transitionInvoice(...args: Parameters<ReducerEngine['transitionInvoice']>) { return this.engine.execute('transitionInvoice', args); }
}
