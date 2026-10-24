import { Timestamp } from 'spacetimedb';
import { schema, table, t, SenderError } from 'spacetimedb/server';
import { ReducerEngine, AuditLog, evaluateStep, type ApprovalGrant } from '@backroom/orchestrator/reducer';
import { evaluate, DEFAULT_POLICY, type Badge, type Context, type Policy } from '@backroom/policy';
import type { Agent, AuditEntry, Escalation, Invoice, Lease, Task, Step } from '@backroom/orchestrator/reducer';

// JSON columns preserve the exported StateStore/fixture shapes. Indexed state and
// visual fields stay typed; private payloads never enter anonymous subscriptions.
const entity = () => table({}, { id: t.string().primaryKey(), json: t.string() });
const invoice = () => table({}, { id: t.string().primaryKey(), state: t.string(), json: t.string() });
const receipt = table({}, { id: t.string().primaryKey(), result: t.string() });
const spacetimedb = schema({
  policy: table({ public: true }, { version: t.u32().primaryKey(), json: t.string() }),
  seat: table({ public: true }, { seatId: t.string().primaryKey(), policyVersion: t.u32(), json: t.string() }),
  badge: table({ public: true }, { seatId: t.string().primaryKey(), policyVersion: t.u32(), allowedRooms: t.array(t.string()), allowedActions: t.array(t.string()), limits: t.string() }),
  room: table({ public: true }, { id: t.string().primaryKey(), name: t.string(), requiredBadge: t.string(), anchors: t.string() }),
  agent: table({ public: true }, {
    id: t.string().primaryKey(), seatId: t.string(), state: t.string(), room: t.string(),
    targetAnchor: t.string(), posX: t.f64(), posY: t.f64(), posZ: t.f64(),
    heartbeatAt: t.timestamp(), currentTaskId: t.string().optional(), modelRoute: t.string(),
  }),
  human: entity(), task: table({}, { id: t.string().primaryKey(), seatId: t.string(), status: t.string(), leaseOwner: t.string().optional(), leaseExpiresAt: t.f64().optional(), leaseToken: t.f64(), cursor: t.u32(), json: t.string() }),
  escalation: table({ public: true }, { id: t.string().primaryKey(), taskId: t.string(), fromAgent: t.string(), toHuman: t.string(), status: t.string(), ruleIds: t.array(t.string()), evidenceRefs: t.array(t.string()), createdAt: t.f64(), expiresAt: t.f64(), json: t.string() }),
  inbox_item: entity(), client: entity(), ar_invoice: invoice(), payment_plan: entity(), payment_link: entity(),
  vendor: entity(), ap_invoice: invoice(), po: entity(), bank_change: entity(), call: entity(), call_turn: entity(),
  signal: entity(), bank_txn: entity(),
  audit_entry: table({ public: true }, {
    seq: t.u64().primaryKey(), id: t.string().unique(), ts: t.f64(), actor: t.string(), seat: t.string(), action: t.string(),
    ruleIds: t.array(t.string()), policyVersion: t.f64(), refs: t.array(t.string()), route: t.string(),
    latencyMs: t.f64(), costUsd: t.f64(), decision: t.string().optional(), inputs: t.string(), prevHash: t.string(), hash: t.string(),
  }),
  runtime_control: table({ public: true }, { id: t.string().primaryKey(), llmEnabled: t.bool(), generation: t.u64(), heartbeatAt: t.timestamp() }),
  payment_receipt: table({}, { id: t.string().primaryKey(), fingerprint: t.string(), json: t.string().optional() }),
  operation_result: receipt,
  controller: table({}, { id: t.u8().primaryKey(), identity: t.identity() }),
});
export default spacetimedb;
type Ctx = Parameters<Parameters<typeof spacetimedb.reducer>[1]>[0];
const json = (value: unknown) => JSON.stringify(value);
function safeInteger(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new SenderError('INTEGER_OVERFLOW');
  return number;
}
const now = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
function authorize(ctx: Ctx) {
  if (!ctx.db.controller.id.find(0)?.identity.isEqual(ctx.sender)) throw new SenderError('CONTROLLER_REQUIRED');
}

// Only the publisher/trusted server can read operation results (including claims).
export const server_results = spacetimedb.view({ public: true }, t.array(receipt.rowType), ctx =>
  ctx.db.controller.id.find(0)?.identity.isEqual(ctx.sender) ? [...ctx.db.operation_result.iter()] : []);

function load(ctx: Ctx): ReducerEngine {
  const engine = new ReducerEngine();
  engine.modelsEnabled = ctx.db.runtime_control.id.find('global')!.llmEnabled;
  for (const a of ctx.db.agent.iter()) engine.agents.set(a.id, { id: a.id, seatId: a.seatId as Badge,
    state: a.state as Agent['state'], room: a.room, targetAnchor: a.targetAnchor || undefined,
    pos: { x: a.posX, y: a.posY, z: a.posZ }, heartbeatAt: Number(a.heartbeatAt.microsSinceUnixEpoch / 1000n),
    currentTaskId: a.currentTaskId, modelRoute: a.modelRoute });
  for (const row of ctx.db.task.iter()) engine.tasks.set(row.id, JSON.parse(row.json));
  for (const row of ctx.db.escalation.iter()) engine.escalations.set(row.id, JSON.parse(row.json));
  for (const rows of [ctx.db.ar_invoice, ctx.db.ap_invoice]) for (const row of rows.iter()) engine.invoices.set(row.id, JSON.parse(row.json));
  for (const row of ctx.db.payment_receipt.iter()) {
    engine.paymentFingerprints.set(row.id, row.fingerprint);
    if (row.json) engine.payments.set(row.id, JSON.parse(row.json));
  }
  engine.audit = new AuditLog([...ctx.db.audit_entry.iter()].sort((a, b) => Number(a.seq - b.seq)).map(row => ({
    ...row, seq: safeInteger(row.seq), actor: row.actor as AuditEntry['actor'], seat: row.seat as AuditEntry['seat'], inputs: JSON.parse(row.inputs), decision: row.decision as AuditEntry['decision'],
  })));
  return engine;
}

function persist(ctx: Ctx, engine: ReducerEngine) {
  // Upserts touch only changed rows; audits are insert-only, never rewritten.
  for (const a of engine.agents.values()) {
    const row = { id: a.id, seatId: a.seatId, state: a.state, room: a.room, targetAnchor: a.targetAnchor ?? '',
      posX: a.pos.x, posY: a.pos.y, posZ: a.pos.z, heartbeatAt: new Timestamp(BigInt(a.heartbeatAt) * 1000n),
      currentTaskId: a.currentTaskId, modelRoute: a.modelRoute };
    const prior = ctx.db.agent.id.find(a.id);
    if (!prior) ctx.db.agent.insert(row);
    else if (json({ ...prior, heartbeatAt: prior.heartbeatAt.toString() }) !== json({ ...row, heartbeatAt: row.heartbeatAt.toString() })) ctx.db.agent.id.update(row);
  }
  for (const task of engine.tasks.values()) {
    const row = { id: task.id, seatId: task.seatId, status: task.status, leaseOwner: task.leaseOwner,
      leaseExpiresAt: task.leaseExpiresAt, leaseToken: task.leaseToken, cursor: task.cursor, json: json(task) };
    const prior = ctx.db.task.id.find(row.id);
    if (!prior) ctx.db.task.insert(row); else if (prior.json !== row.json) ctx.db.task.id.update(row);
  }
  for (const e of engine.escalations.values()) {
    const row = { id: e.id, taskId: e.taskId, fromAgent: e.fromAgent, toHuman: e.toHuman, status: e.status,
      ruleIds: e.ruleIds, evidenceRefs: e.evidenceRefs, createdAt: e.createdAt, expiresAt: e.expiresAt, json: json(e) };
    const prior = ctx.db.escalation.id.find(e.id);
    if (!prior) ctx.db.escalation.insert(row); else if (prior.json !== row.json) ctx.db.escalation.id.update(row);
  }
  for (const i of engine.invoices.values()) {
    const rows = i.kind === 'ar' ? ctx.db.ar_invoice : ctx.db.ap_invoice;
    const prior = rows.id.find(i.id);
    const row = { id: i.id, state: i.state, json: json({ ...(prior ? JSON.parse(prior.json) : {}), ...i }) };
    if (!prior) rows.insert(row); else if (row.json !== prior.json) rows.id.update(row);
  }
  for (const [id, fingerprint] of engine.paymentFingerprints) {
    const row = { id, fingerprint, json: engine.payments.has(id) ? json(engine.payments.get(id)) : undefined };
    const prior = ctx.db.payment_receipt.id.find(id);
    if (!prior) ctx.db.payment_receipt.insert(row); else if (prior.json !== row.json) ctx.db.payment_receipt.id.update(row);
  }
  const control = ctx.db.runtime_control.id.find('global')!;
  if (control.llmEnabled !== engine.llmEnabled) ctx.db.runtime_control.id.update({ ...control, llmEnabled: engine.llmEnabled, generation: control.generation + 1n, heartbeatAt: ctx.timestamp });
  for (const entry of engine.audit.list(ctx.db.audit_entry.count() ? Number(ctx.db.audit_entry.count()) : 0)) {
    ctx.db.audit_entry.insert({ ...entry, seq: BigInt(entry.seq), decision: entry.decision, inputs: json(entry.inputs ?? {}) });
  }
}

export const init = spacetimedb.init(ctx => {
  ctx.db.controller.insert({ id: 0, identity: ctx.sender });
  ctx.db.runtime_control.insert({ id: 'global', llmEnabled: true, generation: 0n, heartbeatAt: ctx.timestamp });
  ctx.db.policy.insert({ version: DEFAULT_POLICY.policyVersion, json: json(DEFAULT_POLICY) });
  for (const [seatId, badge] of Object.entries(DEFAULT_POLICY.badges)) {
    ctx.db.seat.insert({ seatId, policyVersion: DEFAULT_POLICY.policyVersion, json: json(badge) });
    ctx.db.badge.insert({ seatId, policyVersion: DEFAULT_POLICY.policyVersion, allowedRooms: badge.rooms,
      allowedActions: badge.actions, limits: json('limits' in badge ? badge.limits : badge) });
  }
  for (const id of ['lobby', 'collections', 'payables', 'vendor_onboarding', 'dana_desk', 'treasury'])
    ctx.db.room.insert({ id, name: id, requiredBadge: id, anchors: json({ desk: `${id}-desk`, door: `${id}-door` }) });
  ctx.db.human.insert({ id: 'Dana', json: json({ id: 'Dana', role: 'controller', deskAnchor: 'Dana_desk' }) });
  const engine = new ReducerEngine();
  engine.registerAgent('collections-1', 'collections', now(ctx));
  persist(ctx, engine);
});

// Adapter writes carry typed StateStore arguments encoded as JSON, never a
// caller-supplied time/chain head. Auth is checked before parsing or reading data.
const args = { requestId: t.string(), payload: t.string() };
type Method = Exclude<keyof ReducerEngine, 'execute' | 'modelsEnabled' | 'llmEnabled' | 'agents' | 'tasks' | 'escalations' | 'audit' | 'payments' | 'paymentFingerprints' | 'invoices'>;
const timeAt: Partial<Record<Method, number>> = { setLlmEnabled: 1, registerAgent: 2, heartbeat: 1, claimTask: 1,
  renewLease: 1, assertLease: 1, reapExpired: 0, setAgentState: 2, setAgentTarget: 2, pauseTask: 1, advanceTask: 1,
  completeTask: 2, createEscalation: 2, createCallEscalation: 1, decideEscalation: 1, expireEscalations: 0,
  reservePayment: 3, recordPayment: 2, transitionInvoice: 4 };
function invoke(method: Method) {
  return spacetimedb.reducer(args, (ctx, { requestId, payload }) => {
    authorize(ctx);
    if (!requestId || requestId.length > 200 || payload.length > 2_000_000) throw new SenderError('INVALID_REQUEST');
    if (ctx.db.operation_result.id.find(requestId)) return; // lost acknowledgement retry
    const values = JSON.parse(payload) as unknown[];
    if (!Array.isArray(values)) throw new SenderError('INVALID_REQUEST');
    const index = timeAt[method];
    if (index !== undefined) values[index] = now(ctx);
    if (method === 'appendAudit') values[0] = { ...values[0] as object, ts: now(ctx) };
    if (method === 'appendAudits') values[0] = (values[0] as object[]).map(entry => ({ ...entry, ts: now(ctx) }));
    const engine = load(ctx);
    guard(ctx, engine, method, values);
    const result = engine.execute(method, values as never, now(ctx));
    persist(ctx, engine);
    ctx.db.operation_result.insert({ id: requestId, result: json({ value: result ?? null }) });
  });
}
function evaluatePersistedStep(ctx: Ctx, badge: Badge, step: Step) {
  const policy = [...ctx.db.policy.iter()].sort((a, b) => b.version - a.version)[0]!;
  const context: Context = { ...step.context, policy: JSON.parse(policy.json) as Policy };
  const invoice = step.input.invoice as { vendorId?: string } | undefined;
  const vendorId = invoice?.vendorId ?? context.vendor?.id;
  const saved = vendorId ? ctx.db.vendor.id.find(vendorId) : undefined;
  if (saved) {
    const vendor = JSON.parse(saved.json);
    const pending = [...ctx.db.bank_change.iter()].some(row => {
      const change = JSON.parse(row.json);
      return change.vendorId === vendorId && !['applied', 'rejected'].includes(change.status);
    });
    context.vendor = { ...context.vendor, id: vendor.id, inMaster: vendor.inMaster === true,
      approved: vendor.approved === true, pendingBankChange: pending || vendor.pendingBankChange !== false,
      knownDomain: vendor.knownDomain };
  }
  return evaluateStep(badge, { ...step, context });
}

function guard(ctx: Ctx, engine: ReducerEngine, method: Method, values: unknown[]) {
  if (method === 'registerAgent' || method === 'enqueueTask') {
    const seat = method === 'registerAgent' ? values[1] : (values[0] as Task)?.seatId;
    if (!ctx.db.badge.seatId.find(String(seat))) throw new SenderError('INVALID_BADGE');
  }
  if (['claimTask', 'renewLease'].includes(method)) {
    const ms = values[2];
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0 || ms > 60_000) throw new SenderError('INVALID_LEASE_DURATION');
  }
  if (['transitionInvoice', 'advanceTask', 'reservePayment', 'recordPayment', 'setAgentState'].includes(method)) {
    const lease = values[0] as Lease;
    engine.assertLease(lease, now(ctx));
    const task = engine.getTask(lease.id)!;
    const agent = engine.getAgent(lease.leaseOwner)!;
    let room = agent.seatId;
    if (method === 'transitionInvoice') {
      const invoice = engine.invoices.get(values[1] as string);
      if (!invoice || !task.refs.includes(invoice.id)) throw new SenderError('INVOICE_NOT_IN_TASK');
      room = invoice.kind === 'ar' ? 'collections' : 'payables';
      if (invoice.kind === 'ap' && invoice.state === 'escalated' && values[2] === 'escalated' && values[3] === 'approved') {
        const approval = task.escalationId ? engine.getEscalation(task.escalationId) : undefined;
        if (!approval || approval.status !== 'approved' || approval.method !== 'passkey' || !approval.credentialId ||
            approval.decision?.kind !== 'Approve' || approval.decidedAt === undefined || approval.decidedAt >= approval.expiresAt)
          throw new SenderError('PASSKEY_APPROVAL_REQUIRED');
      }
      if (invoice.kind === 'ap' && invoice.state === 'scheduled' && values[2] === 'scheduled' && values[3] === 'paid' && (!task.idempotencyKey || !engine.getPayment(task.idempotencyKey)))
        throw new SenderError('PAYMENT_RECEIPT_REQUIRED');
    }
    const decision = evaluate(agent.seatId, { type: 'enter_room', room }, {});
    if (decision.kind !== 'ALLOW') throw new SenderError(`${decision.kind}:${decision.ruleIds.join(',')}`);
    if (['advanceTask', 'reservePayment', 'recordPayment'].includes(method)) {
      const step = task.steps[task.cursor];
      if (step) {
        const checked = evaluatePersistedStep(ctx, agent.seatId, step);
        if (checked.kind !== 'ALLOW') throw new SenderError(`${checked.kind}:${checked.ruleIds.join(',')}`);
      }
    }
  }
  if (method === 'createEscalation') {
    const task = engine.getTask((values[0] as Lease).id);
    const step = task?.steps[task.cursor];
    if (step) {
      const result = evaluatePersistedStep(ctx, task!.seatId, step);
      if (result.kind !== 'ESCALATE') throw new SenderError('ESCALATION_NOT_REQUIRED');
      values[1] = result;
    }
  }
  if (method === 'createCallEscalation') {
    const input = values[0] as { fromAgent: string; seat: Badge };
    const agent = engine.getAgent(input.fromAgent);
    if (!ctx.db.badge.seatId.find(input.seat) || (agent && agent.seatId !== input.seat)) throw new SenderError('INVALID_BADGE');
  }
  if (method === 'decideEscalation') {
    const grant = values[0] as ApprovalGrant;
    const human = ctx.db.human.id.find(grant?.human);
    if (!human || !grant.credentialId || !['Approve', 'Deny', 'Counter'].includes(grant.decision?.kind)) throw new SenderError('PASSKEY_REQUIRED');
  }
}

export const set_llm_enabled = invoke('setLlmEnabled');
export const register_agent = invoke('registerAgent');
export const get_agent = invoke('getAgent');
export const heartbeat = invoke('heartbeat');
export const enqueue_task = invoke('enqueueTask');
export const get_task = invoke('getTask');
export const claim_task = invoke('claimTask');
export const renew_lease = invoke('renewLease');
export const assert_lease = invoke('assertLease');
export const reap_expired = invoke('reapExpired');
export const set_agent_state = invoke('setAgentState');
export const pause_task = invoke('pauseTask');
export const advance_task = invoke('advanceTask');
export const complete_task = invoke('completeTask');
export const create_escalation = invoke('createEscalation');
export const get_escalation = invoke('getEscalation');
export const create_call_escalation = invoke('createCallEscalation');
export const decide_escalation = invoke('decideEscalation');
export const expire_escalations = invoke('expireEscalations');
export const append_audit = invoke('appendAudit');
export const append_audits = invoke('appendAudits');
export const list_audit = invoke('listAudit');
export const get_audit = invoke('getAudit');
export const verify_audit_chain = invoke('verifyAuditChain');
export const get_payment = invoke('getPayment');
export const reserve_payment = invoke('reservePayment');
export const record_payment = invoke('recordPayment');
export const insert_invoice = invoke('insertInvoice');
export const transition_invoice = invoke('transitionInvoice');
export const set_agent_target_leased = invoke('setAgentTarget');

// T8 visual-only targeting remains available; never changes room/authority.
export const set_agent_target = spacetimedb.reducer({ agentId: t.string(), targetAnchor: t.string() }, (ctx, { agentId, targetAnchor }) => {
  authorize(ctx);
  const agent = ctx.db.agent.id.find(agentId);
  if (!agent) throw new SenderError('AGENT_NOT_FOUND');
  if (!targetAnchor.trim() || targetAnchor.length > 120) throw new SenderError('INVALID_ANCHOR');
  ctx.db.agent.id.update({ ...agent, targetAnchor, heartbeatAt: ctx.timestamp });
});
export const request_room_entry = spacetimedb.reducer({ agentId: t.string(), room: t.string() }, (ctx, { agentId, room }) => {
  authorize(ctx);
  const agent = ctx.db.agent.id.find(agentId);
  if (!agent) throw new SenderError('AGENT_NOT_FOUND');
  const decision = evaluate(agent.seatId as Badge, { type: 'enter_room', room }, {});
  const engine = load(ctx);
  engine.appendAudit({ ts: now(ctx), actor: 'code', seat: agent.seatId as Badge, action: 'request_room_entry', inputs: { agentId, room }, decision: decision.kind,
    ruleIds: decision.ruleIds, policyVersion: decision.policyVersion, refs: [agentId, room], route: 'code', latencyMs: 0, costUsd: 0 });
  persist(ctx, engine);
  // DENY commits only the audit evidence; the denied room is never written.
  if (decision.kind === 'ALLOW') ctx.db.agent.id.update({ ...agent, room, heartbeatAt: ctx.timestamp });
});

/** One-time fixture ingress, deliberately no generic update/delete reducer. */
export const seed_company = spacetimedb.reducer({ payload: t.string() }, (ctx, { payload }) => {
  authorize(ctx);
  const seed = JSON.parse(payload);
  const before = ctx.db.vendor.count() + ctx.db.client.count() + ctx.db.ar_invoice.count() + ctx.db.ap_invoice.count();
  if (seed.schemaVersion !== 1 || seed.synthetic !== true || seed.company?.id !== 'northfield') throw new SenderError('INVALID_SEED');
  const write = (rows: typeof ctx.db.client, list: { id: string }[]) => {
    for (const row of list) {
      const prior = rows.id.find(row.id);
      if (!prior) rows.insert({ id: row.id, json: json(row) });
    }
  };
  write(ctx.db.vendor, seed.vendors); write(ctx.db.po, seed.purchaseOrders); write(ctx.db.client, seed.clients);
  write(ctx.db.bank_change, seed.bankChanges); write(ctx.db.bank_txn, seed.bankTransactions);
  write(ctx.db.payment_link, seed.paymentLinks); write(ctx.db.signal, seed.signals);
  for (const [kind, list] of [['ar', seed.arInvoices], ['ap', seed.apInvoices]] as const) {
    const rows = kind === 'ar' ? ctx.db.ar_invoice : ctx.db.ap_invoice;
    for (const entry of list) if (!rows.id.find(entry.id)) rows.insert({ id: entry.id, state: entry.status, json: json({ ...entry, kind, state: entry.status }) });
  }
  const after = ctx.db.vendor.count() + ctx.db.client.count() + ctx.db.ar_invoice.count() + ctx.db.ap_invoice.count();
  if (after !== before) eventAudit(ctx, 'seed_company', ['fixtures/company/northfield.json']);
});
export const submit_inbox_item = spacetimedb.reducer({ payload: t.string() }, (ctx, { payload }) => {
  authorize(ctx);
  const row = JSON.parse(payload);
  if (!row.id || !['seed', 'judge'].includes(row.source) || !['email', 'invoice', 'bank_change'].includes(row.kind)) throw new SenderError('INVALID_INBOX_ITEM');
  if (ctx.db.inbox_item.id.find(row.id)) throw new SenderError('INBOX_ITEM_EXISTS');
  ctx.db.inbox_item.insert({ id: row.id, json: json({ ...row, status: 'received' }) });
  eventAudit(ctx, 'submit_inbox_item', [row.id]);
});
export const apply_bank_change = spacetimedb.reducer({ changeId: t.string(), escalationId: t.string() }, (ctx, { changeId, escalationId }) => {
  authorize(ctx);
  const row = ctx.db.bank_change.id.find(changeId);
  const approvalRow = ctx.db.escalation.id.find(escalationId);
  if (!row || !approvalRow) throw new SenderError('BANK_CHANGE_NOT_FOUND');
  const change = JSON.parse(row.json);
  const approval = JSON.parse(approvalRow.json) as Escalation;
  if (change.status === 'applied') {
    if (change.approvedEscalationId !== escalationId) throw new SenderError('APPROVAL_MISMATCH');
    return;
  }
  if (change.status !== 'awaiting_controller' || !change.verified || approval.status !== 'approved' ||
      approval.method !== 'passkey' || !approval.credentialId || approval.decision?.kind !== 'Approve' ||
      approval.decidedAt === undefined || approval.decidedAt >= approval.expiresAt ||
      !approval.evidenceRefs.includes(changeId) || approval.policyVersion !== DEFAULT_POLICY.policyVersion) throw new SenderError('PASSKEY_APPROVAL_REQUIRED');
  const vendorRow = ctx.db.vendor.id.find(change.vendorId);
  if (!vendorRow) throw new SenderError('VENDOR_NOT_FOUND');
  const vendor = JSON.parse(vendorRow.json);
  if ((vendor.revision ?? 0) !== change.baselineRevision) throw new SenderError('STALE_BANK_CHANGE');
  ctx.db.vendor.id.update({ id: vendorRow.id, json: json({ ...vendor, approvedBankRef: change.proposedBankRef,
    bankDetails: change.bankDetails, pendingBankChange: false, revision: (vendor.revision ?? 0) + 1 }) });
  ctx.db.bank_change.id.update({ id: row.id, json: json({ ...change, status: 'applied', approvedEscalationId: escalationId }) });
  const engine = load(ctx);
  engine.appendAudit({ ts: now(ctx), actor: 'code', seat: 'vendor_onboarding', action: 'apply_bank_change', ruleIds: ['BANK_CHANGE_HOLD'],
    policyVersion: approval.policyVersion, refs: [changeId, escalationId, vendor.id], route: 'passkey', latencyMs: 0, costUsd: 0 });
  persist(ctx, engine);
});
export const verify_bank_change = spacetimedb.reducer({ changeId: t.string(), payload: t.string() }, (ctx, { changeId, payload }) => {
  authorize(ctx);
  const row = ctx.db.bank_change.id.find(changeId);
  if (!row) throw new SenderError('BANK_CHANGE_NOT_FOUND');
  const change = JSON.parse(row.json);
  if (!['pending', 'proposed', 'verifying'].includes(change.status)) throw new SenderError('INVALID_BANK_CHANGE_TRANSITION');
  const proof = JSON.parse(payload);
  if (!proof.crsClear || !proof.domainMatch || !proof.onFileContactConfirmed || !proof.footprintVerified ||
      !Array.isArray(proof.evidenceRefs) || proof.evidenceRefs.length < 1) throw new SenderError('BANK_CHANGE_UNVERIFIED');
  const vendor = JSON.parse(ctx.db.vendor.id.find(change.vendorId)?.json ?? 'null');
  if (!vendor || !proof.bankDetails || !change.proposedBankRef) throw new SenderError('INVALID_BANK_CHANGE');
  ctx.db.bank_change.id.update({ id: row.id, json: json({ ...change, verified: true, status: 'awaiting_controller',
    evidenceRefs: proof.evidenceRefs, baselineRevision: vendor.revision ?? 0, bankDetails: proof.bankDetails }) });
  eventAudit(ctx, 'verify_bank_change', [changeId, ...proof.evidenceRefs]);
});

export const sync_control = spacetimedb.reducer({}, ctx => {
  authorize(ctx);
  const control = ctx.db.runtime_control.id.find('global')!;
  ctx.db.runtime_control.id.update({ ...control, heartbeatAt: ctx.timestamp });
});
export const ack_result = spacetimedb.reducer({ requestId: t.string() }, (ctx, { requestId }) => {
  authorize(ctx);
  ctx.db.operation_result.id.delete(requestId);
});

function eventAudit(ctx: Ctx, action: string, refs: string[]) {
  const engine = load(ctx);
  engine.appendAudit({ ts: now(ctx), actor: 'code', seat: 'controller', action, ruleIds: [], policyVersion: 0,
    refs, route: 'code', latencyMs: 0, costUsd: 0 });
  persist(ctx, engine);
}

/** Immutable trusted-service event ingress. Raw text remains data. */
function appendEntity(ctx: Ctx, rows: typeof ctx.db.call, id: string, value: object) {
  if (!id || id.length > 200) throw new SenderError('INVALID_EVENT_ID');
  const encoded = json(value);
  const prior = rows.id.find(id);
  if (prior) {
    if (prior.json !== encoded) throw new SenderError('EVENT_ID_CONFLICT');
    return;
  }
  rows.insert({ id, json: encoded });
  eventAudit(ctx, 'record_event', [id]);
}
export const record_call = spacetimedb.reducer({ payload: t.string() }, (ctx, { payload }) => {
  authorize(ctx);
  const call = JSON.parse(payload);
  if (!call.callId || !call.invoiceId || !call.clientId) throw new SenderError('INVALID_CALL');
  appendEntity(ctx, ctx.db.call, call.callId, call);
});
export const record_call_turn = spacetimedb.reducer({ payload: t.string() }, (ctx, { payload }) => {
  authorize(ctx);
  const turn = JSON.parse(payload);
  if (!turn.callId || !ctx.db.call.id.find(turn.callId) || !turn.webhookRequestId) throw new SenderError('INVALID_CALL_TURN');
  // A provider delivery ID is globally unique, including across calls.
  appendEntity(ctx, ctx.db.call_turn, turn.webhookRequestId, turn);
});
export const record_signal = spacetimedb.reducer({ payload: t.string() }, (ctx, { payload }) => {
  authorize(ctx);
  const signal = JSON.parse(payload);
  if (!signal.source || !signal.type || !Number.isFinite(signal.confidence) || signal.confidence < 0 || signal.confidence > 1) throw new SenderError('INVALID_SIGNAL');
  appendEntity(ctx, ctx.db.signal, signal.id, signal);
});
export const record_bank_txn = spacetimedb.reducer({ payload: t.string() }, (ctx, { payload }) => {
  authorize(ctx);
  const txn = JSON.parse(payload);
  if (!txn.nessieId || !Number.isSafeInteger(txn.amountCents) || txn.amountCents <= 0 || !txn.memo) throw new SenderError('INVALID_BANK_TXN');
  appendEntity(ctx, ctx.db.bank_txn, txn.nessieId, txn);
});
function callPolicy(ctx: Ctx, callId: string, agentId: string) {
  const row = ctx.db.call.id.find(callId);
  const agent = ctx.db.agent.id.find(agentId);
  if (!row || !agent) throw new SenderError('CALL_NOT_FOUND');
  const call = JSON.parse(row.json);
  if (call.agentId && call.agentId !== agentId) throw new SenderError('CALL_AGENT_MISMATCH');
  return { call, badge: agent.seatId as Badge, context: { ...call.policyState, identityConfirmed: call.identityConfirmed, receivable: call.receivable } };
}
export const record_payment_plan = spacetimedb.reducer({ id: t.string(), callId: t.string(), agentId: t.string(), payload: t.string() }, (ctx, { id, callId, agentId, payload }) => {
  authorize(ctx);
  const { call, badge, context } = callPolicy(ctx, callId, agentId);
  const plan = JSON.parse(payload);
  const decision = evaluate(badge, { type: 'propose_plan', plan }, context);
  if (decision.kind !== 'ALLOW') throw new SenderError(`${decision.kind}:${decision.ruleIds.join(',')}`);
  appendEntity(ctx, ctx.db.payment_plan, id, { id, callId, invoiceId: call.invoiceId, agentId, plan, policyVersion: decision.policyVersion });
});
export const record_payment_link = spacetimedb.reducer({ id: t.string(), planId: t.string(), amountCents: t.f64() }, (ctx, { id, planId, amountCents }) => {
  authorize(ctx);
  const row = ctx.db.payment_plan.id.find(planId);
  if (!row) throw new SenderError('PLAN_NOT_FOUND');
  const saved = JSON.parse(row.json);
  const { call, badge, context } = callPolicy(ctx, saved.callId, saved.agentId);
  const decision = evaluate(badge, { type: 'send_payment_link', plan: saved.plan, amountCents }, { ...context, policyVersion: saved.policyVersion });
  if (decision.kind !== 'ALLOW') throw new SenderError(`${decision.kind}:${decision.ruleIds.join(',')}`);
  appendEntity(ctx, ctx.db.payment_link, id, { id, planId, callId: saved.callId, invoiceId: call.invoiceId, amountCents });
});
