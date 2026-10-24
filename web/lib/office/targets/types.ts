/**
 * Shared shape of a Play target module. Pure: no React, no WebGL. A target lists where it can be
 * interacted with, its HUD prompt, and its panel data (read from the snapshot only).
 */
import type { AnchorId, OfficeSnapshot } from "../state";
import type { Handoff } from "../handoffs";
import type { AgentTalk } from "../agent-talk";

export type HandoffResolver = (actor: string) => Handoff | undefined;

export type Vec2 = readonly [x: number, z: number];
export interface PlayPanelEntry { readonly id: string; readonly decision: string; readonly summary: string; readonly ruleIds: readonly string[] }
export interface PlayPanelOf<K extends string = string> {
  readonly kind: K;
  readonly title: string;
  readonly state?: string;
  readonly task?: string;
  readonly badge?: { readonly policyVersion: number; readonly limits: readonly (readonly [string, string])[] };
  readonly seated?: readonly { readonly id: string; readonly name: string; readonly state: string }[];
  readonly locked?: string;
  readonly denial?: PlayPanelEntry;
  readonly handoff?: { readonly from: string; readonly to: string; readonly caseDisplayId: string; readonly reason: string; readonly summary: string; readonly status: string; readonly correction: boolean; readonly errorCode?: string };
  /** Conversation for agents you can talk to (agent-talk.ts). */
  readonly talk?: AgentTalk;
  readonly entries: readonly PlayPanelEntry[];
}
export interface PlayCandidateOf<T> { readonly target: T; readonly position: Vec2; readonly radius: number }
/** What every target's `candidates` sees: agents at their drawn (motion) positions and the visible rooms. */
export interface TargetContext {
  readonly agents: readonly { id: string; position: Vec2 }[];
  readonly handoffAgents?: readonly { id: string; position: Vec2 }[];
  readonly visible: ReadonlySet<AnchorId>;
}
export interface PlayTargetModule<T extends { kind: string }> {
  /** Equal to the target's `kind`. */
  readonly id: T["kind"];
  candidates(context: TargetContext): readonly PlayCandidateOf<T>[];
  /** Stable identity for the HUD; defaults to the kind. */
  key?(target: T): string;
  /** HUD prompt, e.g. "Talk to Ada". */
  label(snapshot: OfficeSnapshot, target: T): string;
  /** Panel data; null when the target is no longer in the snapshot. */
  panel(snapshot: OfficeSnapshot, target: T, handoffFor?: HandoffResolver): PlayPanelOf<T["kind"]> | null;
}
export function defineTarget<T extends { kind: string }>(target: PlayTargetModule<T>): PlayTargetModule<T> { return target; }

const MAX_ENTRIES = 8;
export function auditEntries(snapshot: OfficeSnapshot, match: (row: OfficeSnapshot["audit"][number]) => boolean): PlayPanelEntry[] {
  return snapshot.audit.filter(match).reverse().slice(0, MAX_ENTRIES)
    .map(row => ({ id: row.id, decision: row.decision, summary: row.summary, ruleIds: row.ruleIds }));
}
export function valueText(value: unknown): string {
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
