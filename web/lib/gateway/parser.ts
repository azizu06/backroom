import { GatewayError, type PlanTerms } from "./store";

export const toolNames = [
  "get_invoice_context",
  "verify_identity_result",
  "propose_plan",
  "check_approval",
  "send_payment_link",
  "mark_dispute",
  "record_opt_out",
  "request_human",
  "report_already_paid",
] as const;
export type ToolName = (typeof toolNames)[number];
export type Invocation = { callId: string; webhookRequestId: string } & (
  | { tool: "propose_plan"; plan: PlanTerms }
  | {
      tool: "verify_identity_result";
      result: "confirmed" | "wrong_person" | "uncertain";
    }
  | { tool: "check_approval"; escalationId: string }
  | { tool: "send_payment_link"; planId: string }
  /** The voice agent's reading of why; code records it, and it never changes the stop. */
  | { tool: "request_human"; reason?: HumanRequestReason }
  | {
      tool:
        | "get_invoice_context"
        | "mark_dispute"
        | "record_opt_out"
        | "report_already_paid";
    }
);
export const humanRequestReasons = ["hostile", "asked_for_person", "other"] as const;
export type HumanRequestReason = (typeof humanRequestReasons)[number];
const invalid = (): never => {
  throw new GatewayError(400, "INVALID_TOOL_REQUEST");
};
const id = (value: unknown): string =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(value)
    ? value
    : invalid();
const number = (
  value: unknown,
  min: number,
  max: number,
  integer = false,
): number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max &&
  (!integer || Number.isInteger(value))
    ? value
    : invalid();

/** Cartesia sends exactly the configured api_schema.request_body_schema, NOT
 * a fixed {arguments: ...} envelope. Verified 2026-10-24:
 * https://docs.cartesia.ai/agents/webhook-tools.md (api_schema, authentication).
 * Configure call_id from a trusted per-call dynamic variable. webhook_request_id
 * must be stable per invocation/retry; docs do not promise an automatic tool ID.
 * This parser is the only transport-shape boundary if live delivery differs.
 */
export function parseInvocation(tool: string, raw: unknown): Invocation {
  if (!toolNames.includes(tool as ToolName))
    throw new GatewayError(404, "UNKNOWN_TOOL");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const body = raw as Record<string, unknown>;
  const base = {
    callId: id(body.call_id),
    webhookRequestId: id(body.webhook_request_id),
  };
  const extras: Record<ToolName, string[]> = {
    get_invoice_context: [],
    verify_identity_result: ["result"],
    propose_plan: [
      "installments",
      "first_payment_pct",
      "duration_days",
      "waive_fee",
      "discount_pct",
    ],
    check_approval: ["escalation_id"],
    send_payment_link: ["plan_id"],
    mark_dispute: [],
    record_opt_out: [],
    request_human: ["reason"],
    report_already_paid: [],
  };
  if (
    Object.keys(body).some(
      (key) =>
        ![
          "call_id",
          "webhook_request_id",
          ...extras[tool as ToolName],
        ].includes(key),
    )
  )
    return invalid();
  switch (tool) {
    case "propose_plan":
      if (typeof body.waive_fee !== "boolean") return invalid();
      return {
        ...base,
        tool,
        plan: {
          installments: number(body.installments, 1, 100, true),
          firstPaymentPct: number(body.first_payment_pct, 0, 100),
          durationDays: number(body.duration_days, 0, 3650, true),
          waiveFee: body.waive_fee,
          discountPct: number(body.discount_pct, 0, 100),
        },
      };
    case "verify_identity_result":
      if (
        body.result !== "confirmed" &&
        body.result !== "wrong_person" &&
        body.result !== "uncertain"
      )
        return invalid();
      return { ...base, tool, result: body.result };
    case "check_approval":
      return { ...base, tool, escalationId: id(body.escalation_id) };
    case "send_payment_link":
      return { ...base, tool, planId: id(body.plan_id) };
    case "request_human":
      // Optional: the relay's own code-side stops forward request_human without a reason.
      if (body.reason === undefined) return { ...base, tool };
      if (!(humanRequestReasons as readonly unknown[]).includes(body.reason)) return invalid();
      return { ...base, tool, reason: body.reason as HumanRequestReason };
    default:
      return {
        ...base,
        tool: tool as
          | "get_invoice_context"
          | "mark_dispute"
          | "record_opt_out"
          | "report_already_paid",
      };
  }
}
