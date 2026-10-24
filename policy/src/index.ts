// Policy engine: pure, no I/O. Spec docs/spec.md §3.1 M1, §4.5. Claude talks, code decides.
// Stream A owns the real rules; this is the contract stub. Rule ids are shared contracts: announce changes on the board.

export type Badge = "collections" | "payables" | "vendor_onboarding";

export type Action = { type: string; [field: string]: unknown };

export type Context = { policyVersion: number; [field: string]: unknown };

export type Decision =
  | { kind: "ALLOW"; ruleIds: string[]; policyVersion: number }
  | { kind: "DENY"; reason: string; ruleIds: string[]; policyVersion: number }
  | { kind: "ESCALATE"; reason: string; toHuman: string; ruleIds: string[]; policyVersion: number };

export function evaluate(badge: Badge, action: Action, context: Context): Decision {
  // Stub: deny everything until stream A implements the badges.
  return {
    kind: "DENY",
    reason: "NOT_IN_BADGE",
    ruleIds: ["NOT_IN_BADGE"],
    policyVersion: context.policyVersion,
  };
}
