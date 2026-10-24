import { createHash, timingSafeEqual } from "node:crypto";
import { GatewayError, type GatewayStore } from "./store";
import { parseInvocation } from "./parser";
import { executeTool } from "./service";
import type { DecidePlan } from "./policy-adapter";
export function createGateway(options: {
  secret: () => string | undefined;
  store: GatewayStore;
  decide?: DecidePlan;
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
