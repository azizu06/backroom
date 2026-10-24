import { z } from 'zod';
import { DEFAULT_POLICY, evaluate, type Decision } from '@backroom/policy';
import { runPreCall, type CallPlan, type PreCallDependencies, type PreCallInput, type PreCallResult } from '../../collections';
import type { DialInput } from '../../voice';
import type { DomainTool, Json, ToolContext } from '../contracts';

/** Trusted case state, rebuilt from the store on every read. Never model input. */
export interface CollectionsCase {
  /** Voice session id; the gateway keys the call record by it. */
  sessionId: string;
  invoice: { amountCents: number; currency: string; daysPastDue: number };
  precall: PreCallInput;
  dial: DialInput;
}
export interface CollectionsCases { load(caseId: string): Promise<CollectionsCase> }
/** Voice layer port. The real adapter wraps dialCollectionCall; tests mock it. */
export interface CallStarter { start(dial: DialInput): Promise<{ sessionId: string; callId: string }> }
export interface CollectionsToolDeps {
  cases: CollectionsCases;
  voice: CallStarter;
  precall: PreCallDependencies;
  now?: () => number;
}
interface ActivationState { ready?: Extract<PreCallResult, { status: 'ready' }>; started?: { sessionId: string; callId: string } }

const none = z.object({}).strict();
const stopOf = (decision: Decision) => ({ decision: decision.kind, ruleIds: decision.ruleIds, reason: 'reason' in decision ? decision.reason : null });

/**
 * Tools for the pre-call Collections planner. The model chooses the order and whether
 * to dial; code owns every permit, identity, plan term and the dial itself.
 */
export function createCollectionsPlannerTools(deps: CollectionsToolDeps) {
  const now = deps.now ?? Date.now;
  const states = new Map<string, ActivationState>();
  const state = (ctx: ToolContext) => {
    let current = states.get(ctx.activation.activationId);
    if (!current) states.set(ctx.activation.activationId, current = {});
    return current;
  };
  async function audit(ctx: ToolContext, action: string, c: CollectionsCase, extra: { decision?: Decision['kind']; ruleIds?: string[]; inputs?: Record<string, unknown> } = {}) {
    await deps.precall.audit.appendAudit({ ts: now(), actor: 'code', seat: 'collections', action, ruleIds: extra.ruleIds ?? [],
      policyVersion: (c.precall.context.policy ?? DEFAULT_POLICY).policyVersion, refs: [c.precall.clientId, c.precall.invoiceId, ...ctx.activation.artifactRefs],
      route: 'code', latencyMs: 0, costUsd: 0, ...(extra.decision && { decision: extra.decision }), ...(extra.inputs && { inputs: extra.inputs }) });
  }
  async function permit(ctx: ToolContext, c: CollectionsCase, action: string) {
    const decision = evaluate('collections', { type: 'call_client' }, c.precall.context);
    await audit(ctx, action, c, { decision: decision.kind, ruleIds: decision.ruleIds, inputs: { decision } });
    if (decision.kind === 'ESCALATE') await deps.precall.escalate(decision, [c.precall.clientId, c.precall.invoiceId]);
    return decision;
  }

  const get_invoice_context: DomainTool<z.infer<typeof none>, Json> = {
    name: 'get_invoice_context',
    description: 'Read the invoice you are preparing a call for: id, amount, currency, days past due. No contact details.',
    input: none,
    async execute(ctx): Promise<Json> {
      await ctx.assertCurrent();
      const c = await deps.cases.load(ctx.activation.caseId);
      return { invoiceId: c.precall.invoiceId, clientId: c.precall.clientId, ...c.invoice, clientType: c.precall.context.client?.type ?? 'unknown' };
    },
  };
  const can_call: DomainTool<z.infer<typeof none>, Json> = {
    name: 'can_call',
    description: 'Ask policy whether a collection call is permitted right now (consent, B2B, calling hours, opt-out, bankruptcy and dispute stops). Returns ALLOW, DENY or ESCALATE.',
    input: none,
    async execute(ctx): Promise<Json> {
      await ctx.assertCurrent();
      const c = await deps.cases.load(ctx.activation.caseId);
      return stopOf(await permit(ctx, c, 'can_call'));
    },
  };
  const run_precall: DomainTool<z.infer<typeof none>, Json> = {
    name: 'run_precall',
    description: 'Run the audited pre-call checks (permit, credit/OFAC, business health) and draft the bounded call plan. Returns status ready, blocked or paused; only ready can be dialed.',
    input: none,
    async execute(ctx): Promise<Json> {
      await ctx.assertCurrent();
      const c = await deps.cases.load(ctx.activation.caseId);
      const result = await runPreCall(c.precall, deps.precall);
      await ctx.assertCurrent();
      const s = state(ctx);
      s.ready = result.status === 'ready' ? result : undefined;
      if (result.status === 'ready') return { status: 'ready', summary: result.summary, healthCheckPending: result.healthCheckPending, plan: result.plan as unknown as Json };
      return { status: result.status, reason: result.reason };
    },
  };
  const start_call: DomainTool<z.infer<typeof none>, Json> = {
    name: 'start_call',
    description: 'Start the collection call through the voice agent. Only works after run_precall returned ready; policy is re-read and re-checked at the dial boundary. The call is placed once.',
    input: none,
    async execute(ctx): Promise<Json> {
      await ctx.assertCurrent();
      const s = state(ctx);
      if (s.started) return { status: 'already_started', callId: s.started.callId };
      if (!s.ready) return { status: 'DENY', reason: 'PRECALL_NOT_READY' };
      const c = await deps.cases.load(ctx.activation.caseId);
      const decision = await permit(ctx, c, 'dial_permit');
      if (decision.kind !== 'ALLOW') return { status: decision.kind, ...stopOf(decision) };
      await ctx.assertCurrent();
      const call = await deps.voice.start(c.dial);
      s.started = call;
      await audit(ctx, 'collections_call_started', c, { inputs: { sessionId: call.sessionId, callId: call.callId, plan: s.ready.plan as CallPlan as unknown as Record<string, unknown> } });
      return { status: 'started', callId: call.callId, sessionId: call.sessionId };
    },
  };
  return {
    tools: [get_invoice_context, can_call, run_precall, start_call] as const,
    /** Result the planner reached in this activation, read by code, never from model prose. */
    started: (activationId: string) => states.get(activationId)?.started,
    release: (activationId: string) => { states.delete(activationId); },
  };
}
