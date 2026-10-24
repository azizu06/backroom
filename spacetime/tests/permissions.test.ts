import { expect, test } from "vitest";
import { createModuleTestHarness, TestAuth } from "spacetimedb/server/test-utils";
import schema, * as moduleExports from "../src/index";

// The SDK uses a local WASM datastore: no server, network, or external credentials.
test("stored collections badge rejects payables room and permits collections", () => {
  const harness = createModuleTestHarness(schema, moduleExports);
  const auth = TestAuth.internal();
  harness.withReducerTx(auth, ctx => moduleExports.init(ctx, {}));
  const before = harness.db.agent.id.find("collections-1");

  harness.withReducerTx(auth, ctx => moduleExports.request_room_entry(ctx, {
    agentId: "collections-1", room: "payables",
  }));
  expect([...harness.db.audit_entry.iter()][0]).toMatchObject({ decision: "DENY", ruleIds: ["NOT_IN_BADGE"] });
  expect(harness.db.agent.id.find("collections-1")).toEqual(before);

  harness.withReducerTx(auth, ctx => moduleExports.request_room_entry(ctx, {
    agentId: "collections-1", room: "collections",
  }));
  expect(harness.db.agent.id.find("collections-1")?.room).toBe("collections");
});
