import type { ActivationResult, AgentRuntime, HandoffRecord, HandoffRequest, Json, Role, Specialist, ToolContext } from '../contracts';
import type { CaseState } from '../handoff-engine';
import { assertVendorHandoff, type VendorToolDeps } from '../tools/vendor';
import type { PayablesToolDeps } from '../tools/payables';
import { payablesSpecialistFor } from './payables';
import { chooseVendorModel, createVendorSpecialist } from './vendor';
import { createCollectionsPlannerSpecialist, createCollectionsPostCallSpecialist, runCollectionsPlanner, runCollectionsPostCall, type PostCallDeps } from './collections';
import type { CollectionsToolDeps } from '../tools/collections';
import { createIntakeSpecialist, runIntakeActivation, type IntakePorts } from './intake';
import { createExtractorSpecialist, type ExtractorDependencies } from './extractor';
import { createReconciler } from './reconciler';
import type { ReconciliationDependencies } from '../tools/reconciliation';
import { createAuditTools, validateAuditorCorrection, type AuditDependencies } from '../tools/audit';
import { createAuditor, runAuditor } from './auditor';

/** How the dispatcher runs one role. Only `specialist` is required. */
export interface RoleModule {
  /** Build this activation's specialist; may pick the model tier from trusted case facts. */
  specialist(ctx: ToolContext): Promise<Specialist> | Specialist;
  /** Custom activation driver (code-owned pre/post routing). Default: `runtime.run(spec, ctx, input)`. */
  run?(runtime: AgentRuntime, spec: Specialist, ctx: ToolContext, input: Json): Promise<ActivationResult>;
  /** Code-owned pre-commit guard. Throw an UPPER_SNAKE code to reject the staged handoff. */
  beforeCommit?(ctx: ToolContext, request: HandoffRequest, state: CaseState): Promise<void>;
  /** Code-owned refs (e.g. audit ids) this activation may cite, recorded as case evidence before it runs. */
  evidenceRefs?(ctx: ToolContext): Promise<string[]>;
  /** Runs after the store committed this role's handoff. */
  afterCommit?(ctx: ToolContext, record: HandoffRecord, state: CaseState): Promise<void>;
}
export type RoleEntry = RoleModule | Specialist;
export type RoleRegistry = Partial<Record<Role, RoleEntry>>;
export const toModule = (entry: RoleEntry): RoleModule => 'prompt' in entry ? { specialist: () => entry } : entry;

/** Server-owned dependencies per role. A role whose deps are absent is not registered,
 * and its cases stop as held (`ROLE_NOT_REGISTERED:<ROLE>`), never guessed. */
export interface RoleDeps {
  intake?: IntakePorts;
  extractor?: ExtractorDependencies;
  /** Host's `loadCase` supplies `correctionReturns`; use `correctionReturns(state, 'reconciler', 'collections')`. */
  reconciler?: ReconciliationDependencies;
  payables?: PayablesToolDeps;
  vendor?: VendorToolDeps;
  collections?: PostCallDeps;
  /** Trusted host chooses the pre-call phase for a separate dispatcher case. Mutually exclusive with post-call. */
  collectionsPlanner?: CollectionsToolDeps;
  /** Host's `loadCase` supplies the persisted `correctionCount`; use `auditorCorrections(state)`. */
  auditor?: AuditDependencies;
}

/** Role workers: add one line per role below (and its deps to RoleDeps). */
export function createRoleRegistry(deps: RoleDeps): RoleRegistry {
  if (deps.collections && deps.collectionsPlanner) throw new Error('COLLECTIONS_ROLE_AMBIGUOUS');
  const registry: RoleRegistry = {};
  if (deps.intake) registry.intake = intakeRole(deps.intake);
  if (deps.extractor) registry.extractor = extractorRole(deps.extractor);
  if (deps.reconciler) registry.reconciler = reconcilerRole(deps.reconciler);
  if (deps.payables) registry.payables = payablesRole(deps.payables);
  if (deps.vendor) registry.vendor = vendorRole(deps.vendor);
  if (deps.collections) registry.collections = collectionsRole(deps.collections);
  if (deps.collectionsPlanner) registry.collections = collectionsPlannerRole(deps.collectionsPlanner);
  if (deps.auditor) registry.auditor = auditorRole(deps.auditor);
  return registry;
}

/** Persisted count of committed handoffs on one edge (e.g. reconciler -> collections returns). */
export function correctionReturns(state: CaseState, from: Role, to: Role): number {
  return state.handoffs.filter(h => h.from === from && h.to === to && h.status !== 'rejected').length;
}

/** Persisted committed auditor correction returns for this case. */
export const auditorCorrections = (state: CaseState) => state.handoffs.filter(h => h.from === 'auditor' && h.status !== 'rejected').length;

export function auditorRole(deps: AuditDependencies): RoleModule {
  const ids = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  return {
    specialist: ctx => createAuditor(ctx, deps),
    // A close-out without a recorded summary, or a refused correction, holds for a human.
    async run(runtime, _spec, ctx, input) {
      let last: ActivationResult | undefined; // keep the receipt if runAuditor's post-check throws
      const capture: AgentRuntime = { run: async (...args) => (last = await runtime.run(...args)) };
      try { return await runAuditor(capture, ctx, input, deps); }
      catch (error) {
        const code = error instanceof Error ? error.message : '';
        if (code !== 'AUDITOR_SUMMARY_REQUIRED' && code !== 'AUDITOR_CORRECTION_NOT_ALLOWED') throw error;
        const usage = last?.usage ?? { activationId: ctx.activation.activationId, sessionId: '', costUsd: Number.NaN, modelUsage: {}, wallMs: 0, initMs: 0 };
        return { kind: 'held', artifactRefs: [], usage };
      }
    },
    beforeCommit: (ctx, request) => validateAuditorCorrection(ctx, request, deps),
    async evidenceRefs(ctx) {
      const check = await createAuditTools(deps).verifyChain.execute(ctx, {}) as { auditIds?: unknown; missing?: { auditId?: unknown }[] };
      return [...new Set([...ids(check.auditIds), ...ids((check.missing ?? []).map(m => m.auditId))])];
    },
  };
}
export function intakeRole(ports: IntakePorts): RoleModule {
  return {
    specialist: ctx => createIntakeSpecialist(ctx, ports),
    // runIntakeActivation keeps the code-owned human exception and the extractor-only guard.
    run: (runtime, _spec, ctx) => runIntakeActivation(runtime, ctx, ports),
  };
}
export function extractorRole(deps: ExtractorDependencies): RoleModule {
  // One Specialist instance isolates per-activation budgets through its own WeakMap.
  const spec = createExtractorSpecialist(deps);
  return { specialist: () => spec };
}
export function reconcilerRole(deps: ReconciliationDependencies): RoleModule {
  return { specialist: ctx => createReconciler(deps, ctx) };
}
export function payablesRole(deps: PayablesToolDeps): RoleModule {
  return { specialist: ctx => payablesSpecialistFor(deps, ctx) };
}
export function vendorRole(deps: VendorToolDeps): RoleModule {
  return {
    async specialist(ctx) {
      const c = await deps.loadCase(ctx.activation);
      return createVendorSpecialist(deps, chooseVendorModel(c, await deps.vendors.getVendor(c.vendorId)));
    },
    // human_review ends without a handoff: that is a human hold, not a finished case.
    async run(runtime, spec, ctx, input) {
      const result = await runtime.run(spec, ctx, input);
      return result.kind === 'done' ? { kind: 'held', artifactRefs: result.artifactRefs, usage: result.usage } : result;
    },
    beforeCommit: (_ctx, request) => assertVendorHandoff(deps.evidence, request),
  };
}
export function collectionsRole(deps: PostCallDeps): RoleModule {
  return {
    specialist: () => createCollectionsPostCallSpecialist(deps),
    run: (runtime, _spec, ctx) => runCollectionsPostCall(runtime, ctx, deps),
  };
}

/** Pre-call case completes only when it starts a call or queues/dedupes a permitted simulated email. */
export function collectionsPlannerRole(deps: CollectionsToolDeps): RoleModule {
  return {
    specialist: () => createCollectionsPlannerSpecialist(deps).spec,
    async run(runtime, _spec, ctx, input) {
      const run = await runCollectionsPlanner(runtime, ctx, deps, input);
      const followedUp = run.kind === 'not_started' && (run.email?.status === 'queued' || run.email?.status === 'duplicate');
      if (run.result.kind === 'done' && run.kind !== 'started' && !followedUp) return { ...run.result, kind: 'held' };
      return run.result;
    },
  };
}
