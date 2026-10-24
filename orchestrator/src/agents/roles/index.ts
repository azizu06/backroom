import type { ActivationResult, AgentRuntime, HandoffRecord, HandoffRequest, Json, Role, Specialist, ToolContext } from '../contracts';
import type { CaseState } from '../handoff-engine';
import { assertVendorHandoff, type VendorToolDeps } from '../tools/vendor';
import type { PayablesToolDeps } from '../tools/payables';
import { payablesSpecialistFor } from './payables';
import { chooseVendorModel, createVendorSpecialist } from './vendor';
import { createCollectionsPostCallSpecialist, runCollectionsPostCall, type PostCallDeps } from './collections';

/** How the dispatcher runs one role. Only `specialist` is required. */
export interface RoleModule {
  /** Build this activation's specialist; may pick the model tier from trusted case facts. */
  specialist(ctx: ToolContext): Promise<Specialist> | Specialist;
  /** Custom activation driver (code-owned pre/post routing). Default: `runtime.run(spec, ctx, input)`. */
  run?(runtime: AgentRuntime, spec: Specialist, ctx: ToolContext, input: Json): Promise<ActivationResult>;
  /** Code-owned pre-commit guard. Throw an UPPER_SNAKE code to reject the staged handoff. */
  beforeCommit?(ctx: ToolContext, request: HandoffRequest, state: CaseState): Promise<void>;
  /** Runs after the store committed this role's handoff. */
  afterCommit?(ctx: ToolContext, record: HandoffRecord, state: CaseState): Promise<void>;
}
export type RoleEntry = RoleModule | Specialist;
export type RoleRegistry = Partial<Record<Role, RoleEntry>>;
export const toModule = (entry: RoleEntry): RoleModule => 'prompt' in entry ? { specialist: () => entry } : entry;

/** Server-owned dependencies per role. A role whose deps are absent is not registered,
 * and its cases stop as held (`ROLE_NOT_REGISTERED:<ROLE>`), never guessed. */
export interface RoleDeps {
  payables?: PayablesToolDeps;
  vendor?: VendorToolDeps;
  collections?: PostCallDeps;
}

/** Role workers: add one line per role below (and its deps to RoleDeps). */
export function createRoleRegistry(deps: RoleDeps): RoleRegistry {
  const registry: RoleRegistry = {};
  if (deps.payables) registry.payables = payablesRole(deps.payables);
  if (deps.vendor) registry.vendor = vendorRole(deps.vendor);
  if (deps.collections) registry.collections = collectionsRole(deps.collections);
  return registry;
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
