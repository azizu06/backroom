import { expect, it } from "vitest";
import * as policy from "./index";

it("exposes pure policy save and signal-envelope helpers", () => {
  expect(policy).toHaveProperty("savePolicy", expect.any(Function));
  expect(policy).toHaveProperty("computeEnvelope", expect.any(Function));
});

it("increments the saved version every time, even for an unchanged draft, without mutating inputs", () => {
  const before = JSON.stringify(policy.DEFAULT_POLICY);
  const draft = structuredClone(policy.DEFAULT_POLICY);
  draft.policyVersion = 900;
  const saved = policy.savePolicy(policy.DEFAULT_POLICY, draft);
  expect(saved.policyVersion).toBe(2);
  expect(policy.savePolicy(saved, saved).policyVersion).toBe(3);
  expect(draft.policyVersion).toBe(900);
  expect(JSON.stringify(policy.DEFAULT_POLICY)).toBe(before);
  saved.badges.collections.limits.maxInstallments = 3;
  expect(draft.badges.collections.limits.maxInstallments).toBe(2);
});

it("computes the default and narrowed envelopes, ignoring all attempts to widen", () => {
  const original = structuredClone(policy.DEFAULT_POLICY);
  original.signalAdjustments.widen = { maxInstallments: 99, minFirstPct: 1, maxPlanDays: 365, feesWaivable: true, maxDiscountPct: 100 };
  const baseline = { payInFull: true, maxInstallments: 2, minFirstPct: 50, maxPlanDays: 30, feesWaivable: false, maxDiscountPct: 0 };
  expect(policy.computeEnvelope(original)).toEqual(baseline);
  expect(policy.computeEnvelope(original, ["widen", "unknown"])).toEqual(baseline);
  expect(policy.computeEnvelope(original, ["widen", "elevated_risk"])).toEqual({
    ...baseline, maxInstallments: 1, minFirstPct: 100, maxPlanDays: 0,
  });
  expect(policy.evaluate("collections", { type: "propose_plan", plan: {
    installments: 2, firstPaymentPct: 50, totalDays: 30, waiveFees: false, discountPct: 0,
  } }, { policy: original, identityConfirmed: true, signals: { active: ["elevated_risk"] } }))
    .toMatchObject({ kind: "ESCALATE", ruleIds: ["MAX_INSTALLMENTS"] });
});

it("rejects invalid policy data and version exhaustion rather than widening authority", () => {
  const invalid = structuredClone(policy.DEFAULT_POLICY);
  invalid.badges.collections.limits.maxInstallments = Number.NaN;
  expect(policy.evaluate("collections", { type: "propose_plan", plan: {
    installments: 4, firstPaymentPct: 50, totalDays: 30, waiveFees: false, discountPct: 0,
  } }, { policy: invalid, identityConfirmed: true })).toMatchObject({ kind: "DENY", ruleIds: ["INVALID_INPUT"] });
  expect(() => policy.savePolicy(policy.DEFAULT_POLICY, invalid)).toThrow();
  invalid.badges.collections.limits.maxInstallments = undefined as unknown as number;
  expect(() => policy.savePolicy(policy.DEFAULT_POLICY, invalid)).toThrow();
  expect(() => policy.savePolicy({ ...policy.DEFAULT_POLICY, policyVersion: Number.MAX_SAFE_INTEGER }, policy.DEFAULT_POLICY)).toThrow();
});

it("does not let saved JSON grant another badge's capability", () => {
  const invalid = structuredClone(policy.DEFAULT_POLICY);
  invalid.badges.collections.actions.push("pay_invoice");
  expect(() => policy.savePolicy(policy.DEFAULT_POLICY, invalid)).toThrow();
});
