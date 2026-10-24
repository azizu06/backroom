import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { GatewayError, type GatewayStore } from "./store";
import { parseInvocation, toolNames, type ToolName } from "./parser";
import type { GatewayCall } from "./store";

const ref = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) ? value : undefined;
/** A tool the gateway does not know, on a known authenticated call: pause the call for a human and
 * audit ESCALATE. Malformed bodies and unknown calls keep 404 UNKNOWN_TOOL; nothing else is read. */
async function unrecognized(store: GatewayStore, tool: string, raw: unknown) {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const callId = ref(body.call_id), webhookRequestId = ref(body.webhook_request_id);
  if (!callId || !webhookRequestId) throw new GatewayError(404, "UNKNOWN_TOOL");
  const requested = /^[a-z][a-z0-9_]{0,63}$/.test(tool) ? tool : "invalid";
  const fingerprint = createHash("sha256").update(JSON.stringify({ unrecognized: requested, callId, webhookRequestId })).digest("hex");
  const result = await store.transact(callId, (call: GatewayCall) => {
    const existing = Object.hasOwn(call.deliveries, webhookRequestId) ? call.deliveries[webhookRequestId] : undefined;
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new GatewayError(409, "WEBHOOK_ID_REUSED");
      return { kind: "ESCALATE", can_confirm: false, duplicate: true, speak: "This delivery was already processed." };
    }
    if (call.status === "active") call.status = "human_requested";
    call.outbox.push({ type: "request_human" });
    call.audits.push({ actor: "code", id: randomUUID(), action: "unrecognized_request", kind: "ESCALATE",
      ruleIds: ["UNRECOGNIZED_REQUEST"], policyVersion: call.policyVersion, webhookRequestId });
    Object.defineProperty(call.deliveries, webhookRequestId, { value: { fingerprint }, enumerable: true, writable: true, configurable: true });
    return { kind: "ESCALATE", can_confirm: false, rule_ids: ["UNRECOGNIZED_REQUEST"], requested_tool: requested,
      speak: "I can't help with that on this call. I have asked a person to follow up and paused collection." };
  }).catch(error => { throw error instanceof GatewayError && error.code === "CALL_NOT_FOUND" ? new GatewayError(404, "UNKNOWN_TOOL") : error; });
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
import { executeTool } from "./service";
import type { DecidePlan } from "./policy-adapter";
export function createGateway(options: {
  secret: () => string | undefined;
  store: GatewayStore;
  decide?: DecidePlan;
  /** Trusted state read before each new action, never from webhook JSON. */
  currentPolicy?: () => ReturnType<import('@backroom/orchestrator').StateStore['getPolicy']>;
  approvalBridge?: (call: import("./store").GatewayCall, input: import("./parser").Invocation, result?: import("./store").ToolResult) => Promise<void>;
}) {
  return async (tool: string, request: Request) => {
    const secret = options.secret();
    if (!secret)
      return Response.json(
        { error: "GATEWAY_NOT_CONFIGURED" },
        { status: 503 },
      );
    const actual = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
    }
    try {
      if (!toolNames.includes(tool as ToolName))
        return await unrecognized(options.store, tool, await request.json().catch(() => undefined));
      const input = parseInvocation(
        tool,
        await request.json().catch(() => {
          throw new GatewayError(400, "INVALID_JSON");
        }),
      );
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
      const result = await options.store.transact(input.callId, async (call) => {
        const existing = Object.hasOwn(call.deliveries, input.webhookRequestId)
          ? call.deliveries[input.webhookRequestId]
          : undefined;
        if (existing) {
          if (existing.fingerprint !== fingerprint)
            throw new GatewayError(409, "WEBHOOK_ID_REUSED");
          return {
            kind: "RECORDED",
            can_confirm: false,
            duplicate: true,
            speak: "This delivery was already processed.",
          };
        }
        if (options.currentPolicy) {
          const policy = await options.currentPolicy();
          call.policyState = { ...call.policyState, policy };
          call.policyVersion = policy.policyVersion;
        }
        await options.approvalBridge?.(call, input);
        const result = executeTool(call, input, options.decide);
        await options.approvalBridge?.(call, input, result);
        Object.defineProperty(call.deliveries, input.webhookRequestId, {
          value: { fingerprint },
          enumerable: true,
          writable: true,
          configurable: true,
        });
        return result;
      });
      return Response.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      return Response.json(
        {
          error: error instanceof GatewayError ? error.code : "GATEWAY_ERROR",
          can_confirm: false,
        },
        {
          status: error instanceof GatewayError ? error.status : 500,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
  };
}
