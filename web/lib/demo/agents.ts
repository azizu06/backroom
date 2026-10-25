/** Server-only narration of an already recorded judge decision. No money/approval ports. */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { getStateStore, type StateStore, type StateTransport,
  MemoryEmailOutbox, PayablesSeat, northfield, createCrsClientFromEnv, createCrsBankChangeRisk, createCrsPublicRecordsCheck, createPreCallHealthCheck, type FinanceInboxItem, type FinanceRepository,
  type InvoiceFields, type VendorFields, type SeatResult, type ControllerPort } from '@backroom/orchestrator';
import { ClaudeAgentRuntime, Dispatcher, FileUsageLedger, MemoryHandoffStore, SpacetimeHandoffStore,
  createRoleRegistry, auditorCorrections, type AgentCaseStore, type CaseResult,
  type QueryFn, type UsageLedger, type Json, type RoleDeps } from '@backroom/orchestrator/agents';
import { MemoryVendorEvidenceStore } from '../../../orchestrator/src/agents/tools/vendor';
import { ApifyBudget, createContactRunner } from '../../../orchestrator/src/agents/tools/vendor-apify';
import { hold } from '../../../orchestrator/src/payables/decisions';

export interface InboxNarration {
  item: FinanceInboxItem;
  fields: InvoiceFields | VendorFields | null;
  repository: FinanceRepository;
  result: SeatResult;
  auditId: string;
}
export const demoAgentsEnabled = (env: Record<string, string | undefined> = process.env) =>
  env.DEMO_AGENTS === '1' || (env.DEMO_AGENTS === undefined && env.BACKROOM_DEMO === '1');

type CollectionsPlannerDeps = NonNullable<RoleDeps['collectionsPlanner']>;
type CollectionsCase = Awaited<ReturnType<CollectionsPlannerDeps['cases']['load']>>;
export interface CallRefusal { outcome: 'refused'; code: string; detail?: string }
export interface DemoCollectionsPlanner {
  caseFor(refusal: CallRefusal): Promise<CollectionsCase | undefined> | CollectionsCase | undefined;
  voice: CollectionsPlannerDeps['voice'];
  precall: CollectionsPlannerDeps['precall'];
  now?: CollectionsPlannerDeps['now'];
}

/** Uses the existing runtime/registry/dispatcher. Injection is for network-free QueryFn tests. */
export function createInboxAgents(options: {
  control: StateStore; transport?: StateTransport; store?: AgentCaseStore; ledger?: UsageLedger;
  query?: QueryFn; credential?: () => string;
  vendor?: Partial<NonNullable<RoleDeps['vendor']>>;
  collectionsPlanner?: DemoCollectionsPlanner;
}) {
  const control = options.control;
  const store = options.store ?? (options.transport ? new SpacetimeHandoffStore(options.transport) : new MemoryHandoffStore({ audit: control }));
  // Match the standalone agent runner's repo-root ledger even when Next's cwd is web/.
  const ledger = options.ledger ?? new FileUsageLedger(resolve(process.cwd().endsWith('/web') ? '..' : '.', '.env.agents/usage-ledger.json'));
  const runtime = new ClaudeAgentRuntime({ query: options.query, recordArtifacts: (ctx, refs) => store.recordArtifacts(ctx, refs), credential: () => (options.credential ?? (() => process.env.ANTHROPIC_API_KEY ?? ''))() });
  const crs = createCrsClientFromEnv();
  const publicRecords = crs && createCrsPublicRecordsCheck(crs);
  const identityFor = (vendorId: string) => {
    const mapping = northfield.vendors.find(row => row.id === vendorId)?.crsIdentityMapping;
    return mapping?.status === 'mapped' && typeof mapping.sandboxIdentityId === 'number' ? mapping.sandboxIdentityId : undefined;
  };
  const risk = crs ? createCrsBankChangeRisk(crs, identityFor) : { async check() { throw new Error('CRS_UNAVAILABLE'); } };
  const cases = new Map<string, { abort: AbortController; opened: Promise<unknown>; done: Promise<CaseResult | undefined> }>();
  const emailOutbox = new MemoryEmailOutbox();
  let collectionSerial = 0;
  let stopped = false;

  function submit(unchecked: InboxNarration): Promise<CaseResult | undefined> {
    if (stopped) return Promise.resolve(undefined);
    const caseId = `agent:${unchecked.item.id}`;
    const prior = cases.get(caseId);
    if (prior) return prior.done;
    // Never retain attachment bytes; extraction happened on the authoritative inbox path.
    const { attachment: _attachment, ...envelope } = unchecked.item;
    const item = structuredClone(envelope), fields = structuredClone(unchecked.fields);
    const { repository, auditId } = unchecked;
    const original = structuredClone(unchecked.result);
    const abort = new AbortController();
    const refs = [item.id, auditId];
    const source = { id: item.id, source: item.source, senderDomain: item.senderDomain };
    const controller: ControllerPort = { async request(decision, evidenceRefs) {
      if (original.escalationId) return original.escalationId;
      const escalation = await control.createCallEscalation({ id: `agent-review:${item.id}`, taskId: item.id,
        fromAgent: `agent:${item.id}`, seat: 'payables', toHuman: decision.toHuman,
        ruleIds: decision.ruleIds, evidenceRefs, policyVersion: decision.policyVersion, quote: decision.quote }, Date.now());
      return escalation.id;
    } };
    const assess = new PayablesSeat({ repository, state: control, controller, paymentRail: 'nessie' });
    const boundFields = () => {
      if (!fields) throw new Error('NARRATION_EXTRACTION_UNAVAILABLE');
      return fields;
    };
    const invoice = () => {
      const value = boundFields();
      if (value.kind !== 'invoice') throw new Error('NARRATION_INVOICE_REQUIRED');
      return value;
    };
    const roles = createRoleRegistry({
      intake: { state: control, controller, judgeNarration: fields !== null,
        classify: async () => ({ kind: fields?.kind ?? 'unknown' }),
        readItem: async (_ctx, ref) => ref === item.id ? { ...item, text: item.text || (fields ? 'Recorded attachment extraction; raw bytes are not retained.' : '') } : undefined },
      extractor: { audit: control,
        readDocument: async (_ctx, ref) => ref === item.id ? { text: item.text || 'Attachment extraction is recorded in the inbox decision.' } : undefined,
        // Reuse what the production router already extracted, including its local/cloud choice.
        // This narration never starts another unledgered model call or re-uploads file bytes.
        readCandidate: async (_ctx, ref) => ref === item.id && fields ? fields as unknown as Json : undefined,
        saveExtraction: async (ctx, artifact) => {
          await ctx.assertCurrent();
          if (!isDeepStrictEqual(artifact.fields, boundFields())) throw new Error('NARRATION_FIELDS_CHANGED');
          // Cite the immutable receipt that contains these exact schema-validated fields.
          return auditId;
        } },
      vendor: { vendors: repository,
        loadCase: async () => { const value = boundFields(); return { vendorId: value.vendorId, kind: value.kind,
          senderDomain: item.senderDomain, claimedDomain: value.kind === 'invoice' ? item.senderDomain : value.domain,
          claimedAccountId: value.bankAccountId }; },
        bankChangeRisk: risk,
        publicRecords: async vendorId => {
          const identity = identityFor(vendorId);
          if (!publicRecords || !identity) return undefined;
          const result = await publicRecords.check(identity);
          const evidence = result.evidence?.find(row => row.product === 'publicRecords');
          return evidence && typeof evidence.bankruptcies === 'number' ? { bankruptcies: evidence.bankruptcies, evidenceRef: `crs:sha256:${evidence.responseHash}` } : undefined;
        },
        // Paid Actor runs have no narration allowance; the existing tool reports skipped_budget.
        health: createPreCallHealthCheck(), contact: createContactRunner(),
        budget: new ApifyBudget({ demoCapUsd: 0 }), evidence: new MemoryVendorEvidenceStore(),
        ...options.vendor },
      payables: { repository, controller, loadCase: async () => ({ fields: invoice(), source }),
        seat: { assess: (...args) => assess.assess(...args),
          // A separate adapter, not PayablesSeat.process: even a clean ALLOW can only hold.
          async process() {
            const decision = original.decision.kind === 'ALLOW' ? hold('INVALID_INPUT') : original.decision;
            await control.appendAudit({ ts: Date.now(), actor: 'code', seat: 'payables', action: 'agent_narration_hold',
              decision: decision.kind, ruleIds: decision.ruleIds, policyVersion: decision.policyVersion,
              refs, route: 'code', latencyMs: 0, costUsd: 0, inputs: { scenario_source: 'judge', narrationOnly: true } });
            return { status: 'held', decision, evidenceRefs: refs };
          } } },
      auditor: { store: control, loadCase: async () => ({ refs, correctionCount: auditorCorrections((await store.getCase(caseId))!) }) },
    });
    const dispatcher = new Dispatcher({ runtime, store, ledger, control, roles, mode: 'demo', runnerId: `judge-narration:${randomUUID()}` });
    const opened = store.openCase({ caseId, role: 'intake', artifactRefs: [item.id], displayId: item.id });
    const done = opened.then(() => stopped ? undefined : dispatcher.runCase({ caseId, role: 'intake',
      artifactRefs: [item.id], credentialOwnerId: 'aziz', signal: abort.signal,
      input: { inboxRef: item.id, decisionRef: auditId, narrationOnly: true } }));
    cases.set(caseId, { abort, opened, done });
    // Keep only control handles after completion; drop the request/document closure.
    return done;
  }
  async function submitCallRefusal(refusal: CallRefusal): Promise<{ status: 'queued' | 'duplicate' } | undefined> {
    const config = options.collectionsPlanner;
    if (stopped || !config) return undefined;
    const trusted = await config.caseFor(refusal);
    if (stopped || !trusted) return undefined;
    const caseId = `agent:call-refusal:${trusted.precall.invoiceId}:${++collectionSerial}`;
    const snapshot = structuredClone(trusted);
    let emailStatus: 'queued' | 'duplicate' | undefined;
    const deps: CollectionsPlannerDeps = {
      cases: { load: async requested => {
        if (requested !== caseId) throw new Error('COLLECTIONS_CASE_NOT_FOUND');
        return structuredClone(snapshot);
      } },
      voice: config.voice,
      precall: config.precall,
      emailFollowUp: { outbox: { async queue(message) {
        emailStatus = await emailOutbox.queue(message);
        return emailStatus;
      } } },
      ...(config.now ? { now: config.now } : {}),
    };
    const abort = new AbortController();
    const roles = createRoleRegistry({ collectionsPlanner: deps });
    const dispatcher = new Dispatcher({ runtime, store, ledger, control, roles, mode: 'demo',
      runnerId: `call-refusal:${randomUUID()}` });
    const artifactRefs = [`ar_invoice:${snapshot.precall.invoiceId}`];
    const opened = store.openCase({ caseId, role: 'collections', artifactRefs, displayId: snapshot.precall.invoiceId });
    const done = opened.then(() => stopped ? undefined : dispatcher.runCase({ caseId, role: 'collections', artifactRefs,
      credentialOwnerId: 'aziz', signal: abort.signal, input: {} }));
    cases.set(caseId, { abort, opened, done });
    const result = await done;
    return result?.status === 'done' && emailStatus ? { status: emailStatus } : undefined;
  }
  async function drain() { await Promise.allSettled([...cases.values()].map(row => row.done)); }
  async function stop() {
    stopped = true;
    const running = [...cases.entries()];
    for (const [, row] of running) row.abort.abort('DEMO_RESET');
    const cancellations = await Promise.allSettled(running.map(async ([caseId, row]) => {
      await row.opened;
      const state = await store.getCase(caseId);
      if (state && ['open', 'paused'].includes(state.status)) {
        try { await store.stopCase(caseId, 'cancelled', 'DEMO_RESET'); }
        catch (error) {
          // The dispatcher can finish/cancel between separate durable read/stop requests.
          // Only a confirmed terminal state makes this race safe; storage failures still retry.
          const latest = await store.getCase(caseId);
          if (!latest || !['done', 'held', 'failed', 'cancelled'].includes(latest.status)) throw error;
        }
      }
    }));
    await drain();
    if (cancellations.some(row => row.status === 'rejected')) throw new Error('DEMO_AGENT_CANCEL_FAILED');
    cases.clear();
  }
  return { submit, submitCallRefusal, stop, drain, store, ledger, emailOutbox };
}

type Host = ReturnType<typeof createInboxAgents>;
type HostConfig = { control: StateStore; transport?: StateTransport; collectionsPlanner?: DemoCollectionsPlanner };
const root = globalThis as typeof globalThis & {
  backroomInboxAgents?: Host;
  backroomInboxAgentConfig?: HostConfig;
};
export function installInboxAgents(control: StateStore, transport?: StateTransport, collectionsPlanner?: DemoCollectionsPlanner) {
  // Defer ledger/SDK construction until an inbox case; failure cannot break demo startup.
  root.backroomInboxAgentConfig = demoAgentsEnabled() ? { control, transport, collectionsPlanner } : undefined;
}
export async function resetInboxAgents() {
  const prior = root.backroomInboxAgents;
  await prior?.stop();
  if (root.backroomInboxAgents === prior) {
    root.backroomInboxAgents = undefined;
    root.backroomInboxAgentConfig = undefined;
  }
}
export async function narrateInbox(input: InboxNarration) {
  if (!demoAgentsEnabled()) return;
  // Demo bootstrap installs its exact transport, including the database selected by reset.
  if (!root.backroomInboxAgents) {
    const config = root.backroomInboxAgentConfig;
    if (!config && process.env.STATE_STORE === 'spacetime') throw new Error('DEMO_AGENTS_NOT_INSTALLED');
    root.backroomInboxAgents = createInboxAgents(config ?? { control: getStateStore() });
  }
  return root.backroomInboxAgents?.submit(input);
}

/** The authenticated call route reports a refusal; the installed demo host rebuilds trusted case data. */
export async function narrateCallRefusal(refusal: CallRefusal) {
  if (!demoAgentsEnabled()) return;
  if (!root.backroomInboxAgents) {
    const config = root.backroomInboxAgentConfig;
    if (!config) return;
    root.backroomInboxAgents = createInboxAgents(config);
  }
  return root.backroomInboxAgents.submitCallRefusal(refusal);
}
