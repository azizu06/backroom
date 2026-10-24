import type { CollectionEnvelope, Context, Decision, Plan } from '@backroom/policy';
import type { StateStore } from '../store';
import type { LlmOffResult } from '../router';

/** Trusted persisted mapping: CRS gets only this ID, never the public company's name. */
export interface PreCallInput {
  clientId: string;
  invoiceId: string;
  testIdentityId: number;
  company: PublicCompany;
  /** Built from current trusted state, including client-local time. Never model/tool input. */
  context: Context;
}
export interface PublicCompany { name: string; website: string; phone?: string }
export interface CreditEvidence {
  product: 'businessCredit' | 'ofac' | 'publicRecords';
  checkedAt: string;
  responseHash: string;
  creditScore?: number;
  bankruptcies?: number;
}
export interface CreditResult {
  testIdentityId: number;
  ofacStatus: 'clear' | 'hit' | 'unknown';
  bankruptcy?: boolean;
  ofacAvailability?: 'not available in sandbox';
  /** Owner-configured signal names; no model determines these. */
  activeSignals: readonly string[];
  evidence: readonly CreditEvidence[];
}
export interface CreditCheck { label?: string; check(testIdentityId: number): Promise<CreditResult> }
interface HealthEvidence { sourceUrl: string; observedAt: string }
export type HealthSignal = HealthEvidence & (
  | { type: 'maps_status'; value: 'operating' | 'permanently_closed' | 'temporarily_closed' | 'unknown' }
  | { type: 'distress_news' | 'phone_match' | 'website_reachable'; value: boolean }
);
export interface HealthResult { signals: readonly HealthSignal[]; apifyRunId?: string }
export interface HealthCheck { label?: string; check(company: PublicCompany, signal: AbortSignal): Promise<HealthResult> }
/** No free-form instructions or speech. Code renders the validated choices and amounts. */
export interface CallPlan {
  tone: 'neutral' | 'empathetic';
  offerOrder: ('pay_in_full' | 'installments')[];
  plan: Plan;
}
export interface PlanningInput {
  envelope: CollectionEnvelope;
  preferPlanFirst: boolean;
  healthCheckPending: boolean;
}
export interface DraftResult {
  output: unknown;
  route: string;
  model: string;
  latencyMs: number;
  costUsd: number;
}
export interface CallPlanner { draft(input: PlanningInput): Promise<DraftResult | LlmOffResult> }
export interface PreCallDependencies {
  credit: CreditCheck;
  health: HealthCheck;
  planner: CallPlanner;
  audit: Pick<StateStore, 'appendAudit'>;
  /** Persist the escalation (e.g. StateStore.createEscalation with the current lease). */
  escalate(decision: Extract<Decision, { kind: 'ESCALATE' }>, evidenceRefs: string[]): Promise<void>;
  now?: () => number;
}
export type PreCallResult =
  | { status: 'paused'; reason: 'LLM_OFF' }
  | { status: 'blocked'; reason: string; decision?: Decision }
  | { status: 'ready'; envelope: CollectionEnvelope; plan: CallPlan; summary: string;
      healthCheckPending: boolean; route: string; model: string; evidenceRefs: string[];
      /** The checked signals, so the dial boundary re-evaluates the same stops and envelope. */
      signals: NonNullable<Context['signals']> };
