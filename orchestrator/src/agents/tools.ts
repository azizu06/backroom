import { createSdkMcpServer, tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { DomainTool, HandoffRequest, Json, Role, Specialist, ToolContext } from './contracts';
import { ALLOWED_GRAPH, ARTIFACT_REF } from './handoff-engine';

export const MCP_SERVER = 'backroom';
export const mcpName = (name: string) => `mcp__${MCP_SERVER}__${name}`;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,47}$/;

/** Per-activation runtime state shared by every tool handler of one query. */
export interface ActivationSession {
  sealed: boolean;
  staged?: HandoffRequest;
  /** Set when a code-owned tool returned `outcome: 'held'` (human hold). */
  held?: { artifactRefs: string[]; ruleIds: string[] };
  /** Refs returned by this activation's tool outputs; the only refs it may cite besides its inputs. */
  producedRefs: Set<string>;
  toolCalls: { name: string; ok: boolean; code?: string }[];
}
export const newSession = (): ActivationSession => ({ sealed: false, producedRefs: new Set(), toolCalls: [] });

/** Tool outputs mark a human hold with `{ outcome: 'held', ruleIds?, artifactRefs? }`. */
export function heldOutput(output: Json): ActivationSession['held'] {
  if (!output || typeof output !== 'object' || Array.isArray(output) || output.outcome !== 'held') return undefined;
  return { artifactRefs: refsIn(output), ruleIds: Array.isArray(output.ruleIds) ? output.ruleIds.map(String) : [] };
}
/** Code-owned refs: top-level `ref`/`*Ref` strings and `refs`/`*Refs` string arrays of a tool output
 * (artifactRef, verdictRef, evidenceRefs, allowedRefs, ...). Model arguments never become refs. */
export function refsIn(output: Json): string[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return [];
  const refs: string[] = [];
  for (const [key, value] of Object.entries(output)) {
    if (/^(ref|.+Ref)$/.test(key) && typeof value === 'string') refs.push(value);
    if (/^(refs|.+Refs)$/.test(key) && Array.isArray(value)) refs.push(...value.filter((v): v is string => typeof v === 'string'));
  }
  return [...new Set(refs.filter(ref => ARTIFACT_REF.test(ref)))];
}
const text = (value: unknown, isError = false) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) });
const errorCode = (error: unknown) => {
  const message = error instanceof Error ? error.message : '';
  return /^[A-Z][A-Z0-9_]*(?::[A-Z0-9_,]+)?$/.test(message) ? message : 'TOOL_FAILED';
};

export interface ToolHooks {
  recordArtifacts?(ctx: ToolContext, refs: string[]): Promise<void>;
  /** Server-side trace of each tool call (no arguments); for logs and debugging only. */
  onToolCall?(event: { activationId: string; role: string; name: string; ok: boolean; code?: string; output?: Json }): void;
}

/** Wrap one plain DomainTool. Policy lives in `execute`; this adds the fencing around it:
 * sealed check, full schema parse, assertCurrent before and after, code-owned ref capture. */
export function toSdkTool(domain: DomainTool<any, Json>, ctx: ToolContext, session: ActivationSession, hooks: ToolHooks = {}): SdkMcpToolDefinition<any> {
  const shape = (domain.input as unknown as { shape?: z.ZodRawShape }).shape;
  if (!shape || typeof shape !== 'object') throw new Error(`TOOL_INPUT_NOT_OBJECT:${domain.name}`);
  return tool(domain.name, domain.description, shape, async args => {
    const record = (ok: boolean, code?: string, output?: Json) => {
      session.toolCalls.push({ name: domain.name, ok, ...(code ? { code } : {}) });
      hooks.onToolCall?.({ activationId: ctx.activation.activationId, role: ctx.activation.role, name: domain.name, ok, ...(code ? { code } : {}), ...(output !== undefined ? { output } : {}) });
    };
    if (session.sealed) { record(false, 'ACTIVATION_SEALED'); return text({ error: 'ACTIVATION_SEALED', instruction: 'Handoff is staged. Stop now.' }, true); }
    try {
      await ctx.assertCurrent();
      const parsed = domain.input.safeParse(args);
      if (!parsed.success) {
        record(false, 'INVALID_INPUT');
        return text({ error: 'INVALID_INPUT', issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), code: i.code })) }, true);
      }
      const output = await domain.execute(ctx, parsed.data);
      await ctx.assertCurrent();
      const refs = refsIn(output);
      if (refs.length) { await hooks.recordArtifacts?.(ctx, refs); for (const ref of refs) session.producedRefs.add(ref); }
      session.held ??= heldOutput(output);
      record(true, undefined, output);
      return text(output);
    } catch (error) {
      const code = errorCode(error);
      record(false, code);
      return text({ error: code }, true);
    }
  });
}

/** The one cross-agent tool. It validates and stages a single offer, then seals the
 * activation; the dispatcher commits it only after this query has fully drained. */
export function handoffTool(spec: Specialist, ctx: ToolContext, session: ActivationSession): SdkMcpToolDefinition<any> {
  const targets = allowedTargets(spec);
  const shape = {
    to: z.enum(targets as [Role, ...Role[]]).describe('Next specialist. Only these destinations are permitted.'),
    reason: z.string().min(1).max(280).describe('Why your responsibility is finished or what evidence is missing.'),
    summary: z.string().min(1).max(500).describe('Short factual note for the next agent and the office speech bubble.'),
    artifactRefs: z.array(z.string().min(1).max(200)).min(1).max(20).describe('Refs returned by your tools or given to you.'),
  };
  return tool('handoff', `Hand this case to the next specialist (${targets.join(', ')}) once your responsibility is done. Call at most once, then stop.`, shape, async args => {
    if (session.sealed) return text({ error: 'HANDOFF_ALREADY_STAGED' }, true);
    try { await ctx.assertCurrent(); } catch (error) { return text({ error: errorCode(error) }, true); }
    const request: HandoffRequest = { to: args.to, reason: args.reason, summary: args.summary, artifactRefs: [...new Set(args.artifactRefs)] };
    const cited = new Set([...ctx.activation.artifactRefs, ...session.producedRefs]);
    const unknown = request.artifactRefs.filter(ref => !cited.has(ref));
    if (!targets.includes(request.to)) return text({ error: 'HANDOFF_EDGE_NOT_ALLOWED', allowed: targets }, true);
    if (unknown.length) return text({ error: 'HANDOFF_UNKNOWN_REF', unknown, citable: [...cited] }, true);
    session.staged = request; session.sealed = true;
    session.toolCalls.push({ name: 'handoff', ok: true });
    return text({ status: 'STAGED', to: request.to, instruction: 'Handoff staged. Do not call more tools; end your turn now.' });
  });
}
export function allowedTargets(spec: Specialist): Role[] {
  return spec.allowedNext.filter(role => ALLOWED_GRAPH[spec.role].includes(role));
}

export function validateSpecialist(spec: Specialist) {
  const names = spec.tools.map(t => t.name);
  if (new Set(names).size !== names.length || names.some(n => !TOOL_NAME.test(n) || n === 'handoff')) throw new Error(`INVALID_TOOL_NAMES:${spec.role}`);
  if (spec.allowedNext.some(role => !ALLOWED_GRAPH[spec.role].includes(role))) throw new Error(`INVALID_ALLOWED_NEXT:${spec.role}`);
}

/** Fresh in-process MCP server holding only this specialist's tools plus `handoff`. */
export function buildSpecialistServer(spec: Specialist, ctx: ToolContext, session: ActivationSession, hooks: ToolHooks = {}) {
  validateSpecialist(spec);
  const definitions = [...spec.tools.map(t => toSdkTool(t, ctx, session, hooks)), ...(allowedTargets(spec).length ? [handoffTool(spec, ctx, session)] : [])];
  return { definitions, allowedNames: definitions.map(d => mcpName(d.name)),
    server: createSdkMcpServer({ name: MCP_SERVER, version: '1.0.0', tools: definitions }) };
}
