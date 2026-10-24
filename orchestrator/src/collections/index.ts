import { DEFAULT_POLICY, evaluate, computeEnvelope, type Context, type Decision } from '@backroom/policy';
import { validateCallPlan, renderCallPlan } from './plan';
import { boundedHealthCheck, boundedCreditCheck } from './checks';
import type { AuditInput } from '../store';
import type { PreCallInput, PreCallDependencies, PreCallResult } from './types';
export type * from './types';
export { createPreCallCreditCheck, createCrsPublicRecordsCheck } from './crs';
export { createCallPlanner } from './planner';
export { createCrsCreditCheck, createApifyHealthCheck } from './adapters';
export { createApifyRunner, createPreCallHealthCheck, APIFY_DEMO_COMPANY } from './apify';
export { fakeCreditCheck, fakeHealthCheck } from './fakes';

/** Prepares a plan only. The dial boundary must re-read state and evaluate call_client again. */
export async function runPreCall(input: PreCallInput, deps: PreCallDependencies): Promise<PreCallResult> {
  // Freeze the trusted snapshot before any asynchronous provider/model work.
  input = structuredClone(input);
  const now = deps.now ?? Date.now;
  const policy = input.context.policy ?? DEFAULT_POLICY;
  const refs = [input.clientId, input.invoiceId];
  async function audit(action: string, fields: Partial<AuditInput> = {}) {
    const entry = await deps.audit.appendAudit({ ts: now(), actor: 'code', seat: 'collections', action,
      ruleIds: [], policyVersion: policy.policyVersion, refs: [...refs], route: 'code',
      latencyMs: 0, costUsd: 0, ...fields });
    refs.push(entry.id);
    return entry;
  }
  async function stop(decision: Exclude<Decision, { kind: 'ALLOW' }>): Promise<PreCallResult> {
    if (decision.kind === 'ESCALATE') {
      await deps.escalate(decision, [...refs]);
      await audit('pre_call_escalated', { decision: decision.kind, ruleIds: decision.ruleIds,
        inputs: { toHuman: decision.toHuman, reason: decision.reason } });
    }
    return { status: 'blocked', reason: decision.reason, decision };
  }
  const decision = evaluate('collections', { type: 'call_client' }, input.context);
  await audit('can_call', { ruleIds: decision.ruleIds, policyVersion: decision.policyVersion, decision: decision.kind, inputs: { decision } });
  if (decision.kind !== 'ALLOW') return stop(decision);

  const creditStart = now();
  const healthStart = now();
  const [credit, health] = await Promise.all([
    boundedCreditCheck(deps.credit, input.testIdentityId).then(async result => {
      await audit('credit_check', { latencyMs: now() - creditStart, inputs: {
        label: deps.credit.label === 'CRS sandbox'
          ? result?.evidence.length ? `CRS sandbox: test identity #${input.testIdentityId}` : 'CRS unavailable: no accepted evidence'
          : deps.credit.label ?? 'provided (source unverified)',
        ...(deps.credit.label === 'CRS sandbox' ? { ofacAvailability: 'not available in sandbox' } : {}), ofacStatus: result?.ofacStatus ?? 'unknown',
        evidence: result?.evidence ?? [],
      } });
      return result;
    }),
    boundedHealthCheck(deps.health, input.company).then(async result => {
      await audit('health_check', { latencyMs: now() - healthStart, inputs: { status: result ? 'complete' : 'pending', label: result?.apifyRunId ? `Apify: live run ${result.apifyRunId}` : deps.health.label ?? 'provided', ...(result?.apifyRunId ? { runId: result.apifyRunId } : {}), signals: result?.signals ?? [] } });
      return result;
    }),
  ]);
  const context: Context = { ...input.context, signals: {
    ...input.context.signals,
    bankruptcy: input.context.signals?.bankruptcy === true || credit?.bankruptcy === true,
    ofacHit: input.context.signals?.ofacHit === true || credit?.ofacStatus === 'hit',
    closedBusiness: input.context.signals?.closedBusiness === true || !!health?.signals.some(signal => signal.type === 'maps_status' && signal.value === 'permanently_closed'),
    active: [...new Set([...(input.context.signals?.active ?? []), ...(credit?.activeSignals ?? []), ...(!health ? ['health_check_pending'] : [])])],
  } };
  const checked = evaluate('collections', { type: 'call_client' }, context);
  await audit('pre_call_permit', { decision: checked.kind, ruleIds: checked.ruleIds, inputs: { decision: checked } });
  if (checked.kind !== 'ALLOW') return stop(checked);
  if (!credit || credit.ofacStatus !== 'clear') {
    await audit('pre_call_blocked', { decision: 'DENY', inputs: { reason: 'Credit/OFAC check unavailable' } });
    return { status: 'blocked', reason: 'Credit/OFAC check unavailable' };
  }
  const envelope = computeEnvelope(policy, context.signals?.active);
  await audit('envelope', { inputs: { envelope } });
  const planStarted = now();
  const draft = await deps.planner.draft({ envelope, preferPlanFirst: !!health?.signals.some(signal => signal.type === 'distress_news' && signal.value), healthCheckPending: !health }).catch(() => undefined);
  if (!draft) {
    await audit('call_plan', { decision: 'DENY', latencyMs: now() - planStarted, inputs: { reason: 'Call planner unavailable' } });
    return { status: 'blocked', reason: 'Call planner unavailable' };
  }
  if ('kind' in draft && draft.kind === 'LLM_OFF') {
    await audit('call_plan', { route: 'code', inputs: { status: 'LLM_OFF', model: 'none' } });
    return { status: 'paused', reason: 'LLM_OFF' };
  }
  await audit('call_plan', { actor: draft.route === 'cloud' ? 'claude' : 'local_model', route: draft.route,
    latencyMs: draft.latencyMs, costUsd: draft.costUsd, inputs: { model: draft.model } });
  const plan = validateCallPlan(draft.output, context);
  await audit('plan_validated', { decision: plan ? 'ALLOW' : 'DENY', inputs: { valid: !!plan, ...(plan ? { plan } : {}) } });
  if (!plan) return { status: 'blocked', reason: 'Invalid call plan or terms outside the envelope' };
  return { status: 'ready', envelope, plan, summary: `${!health ? 'health check pending. ' : ''}${renderCallPlan(plan)}`, healthCheckPending: !health,
    route: draft.route, model: draft.model, evidenceRefs: refs };
}
