import { describe, expect, it } from "vitest";
import { evaluate } from "./index";

describe("evaluate (stub)", () => {
  it("denies with NOT_IN_BADGE and cites the policy version", () => {
    const d = evaluate("collections", { type: "pay_invoice" }, { policyVersion: 3 });
    expect(d).toMatchObject({ kind: "DENY", reason: "NOT_IN_BADGE", policyVersion: 3 });
  });
});
