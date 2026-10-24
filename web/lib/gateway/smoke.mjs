// Opt-in HTTP smoke; never places a call, sends an email, or approves terms.
// TOOL_GATEWAY_URL=https://your-host TOOL_GATEWAY_SECRET=... node web/lib/gateway/smoke.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.TOOL_GATEWAY_URL;
const secret = process.env.TOOL_GATEWAY_SECRET;
if (!base || !secret)
  throw new Error("Set TOOL_GATEWAY_URL and TOOL_GATEWAY_SECRET explicitly.");
const url = new URL("/api/tools/get_invoice_context", base);
const callId =
  process.env.TOOL_GATEWAY_SMOKE_CALL_ID ?? `smoke-${randomUUID()}`;
const body = JSON.stringify({
  call_id: callId,
  webhook_request_id: randomUUID(),
});
const bad = await fetch(url, {
  method: "POST",
  headers: { authorization: "Bearer invalid" },
  body,
});
assert.equal(bad.status, 401);
const good = await fetch(url, {
  method: "POST",
  headers: { authorization: `Bearer ${secret}` },
  body,
});
assert.equal(good.status, process.env.TOOL_GATEWAY_SMOKE_CALL_ID ? 200 : 404);
console.log(
  "Gateway HTTP auth and call lookup smoke passed; no financial side effect requested.",
);
