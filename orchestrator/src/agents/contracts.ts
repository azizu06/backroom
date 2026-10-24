import type { ZodType } from 'zod';

/** Framework-neutral contracts for the seven-role agent runtime (Claude Agent SDK GO spike).
 * Role workers import from here; runtime, dispatcher, tools and handoff-store live beside it.
 * Roles are logical agents, not policy badges: authority stays in each tool's handler. */
export const ROLES = ['intake', 'extractor', 'vendor', 'payables', 'collections', 'reconciler', 'auditor'] as const;
export type Role = typeof ROLES[number];
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type SpecialistModel = 'claude-haiku-5-5' | 'claude-sonnet-5-5';

/** Server-created for one top-level query; nothing here is parsed from model output. */
export interface Activation {
  caseId: string; taskId: string; activationId: string; role: Role;
  leaseOwner: string; leaseToken: number; llmGeneration: number;
  artifactRefs: string[]; credentialOwnerId: string; signal: AbortSignal;
}
/** The only fields a model supplies when it hands off. */
export interface HandoffRequest {
  to: Role; reason: string; summary: string; artifactRefs: string[];
}
export interface HandoffRecord extends HandoffRequest {
  handoffId: string; caseId: string; from: Role; fromActivationId: string;
  leaseToken: number; status: 'offered' | 'accepted' | 'completed' | 'rejected';
}
export interface ToolContext {
  activation: Activation; // server-created; never parsed from model args
  assertCurrent(): Promise<void>; // lease, OFF/generation, capability and fresh state
  /** Synchronous ownership check for the instant before an external effect (payment
   * reservation, provider request). Never awaits, so no takeover can land between the
   * check and the effect. Throws when this activation is no longer current. */
  fence?(): void;
}
/** A plain function the runtime exposes as one MCP tool. Enforce policy inside `execute`. */
export interface DomainTool<I, O> {
  name: string; description: string; input: ZodType<I>;
  execute(ctx: ToolContext, input: I): Promise<O>;
}
export interface Specialist {
  role: Role; model: SpecialistModel;
  prompt: string; tools: readonly DomainTool<any, Json>[];
  allowedNext: readonly Role[];
}
/** Latest cumulative SDK result for the activation's session; never a sum of results. */
export interface UsageReceipt {
  activationId: string; sessionId: string; costUsd: number;
  modelUsage: Record<string, Json>; wallMs: number; initMs: number;
}
export type ActivationResult =
  | { kind: 'handoff'; request: HandoffRequest; usage: UsageReceipt }
  | { kind: 'done' | 'held'; artifactRefs: string[]; usage: UsageReceipt }
  | { kind: 'paused' | 'failed'; reason: string; usage?: UsageReceipt };
export interface AgentRuntime {
  run(spec: Specialist, ctx: ToolContext, input: Json): Promise<ActivationResult>;
}
export interface HandoffStore {
  // One atomic transaction: validate owner/token/ref existence/role graph,
  // dedupe, finish source activation and enqueue exactly one target activation.
  // Idempotency is bound to source activation; it is not a model argument.
  commit(ctx: ToolContext, request: HandoffRequest): Promise<HandoffRecord>;
}
