import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, evaluate as rawEvaluate, firstPaymentCents, savePolicy, POLICY_SENTENCES, RULE_SENTENCES, type Plan } from "./index";

const evaluate: typeof rawEvaluate = (...args) => {
  const result = rawEvaluate(...args);
  expect(result.ruleIds.length).toBeGreaterThan(0);
  if (result.kind !== "ALLOW") {
    const sentenceId = RULE_SENTENCES[result.ruleIds[0]!];
    expect(result.quote).toEqual({ sentenceId, text: POLICY_SENTENCES[sentenceId] });
    expect(result.reason).toContain(result.quote.text);
  }
  return result;
};

describe("badge authority", () => {
  it("allows Collections to read AR with an auditable version", () => {
    expect(evaluate("collections", { type: "read_ar" }, { policyVersion: 1 }))
      .toEqual({ kind: "ALLOW", ruleIds: ["IN_BADGE"], policyVersion: 1 });
  });
});

it("denies cross-badge requests with an exact owner-policy sentence", () => {
  expect(evaluate("collections", { type: "pay_invoice" }, { policyVersion: 1 }))
    .toMatchObject({
      kind: "DENY", ruleIds: ["NOT_IN_BADGE"], policyVersion: 1,
      quote: { sentenceId: "NF-001", text: "Each seat may use only the actions and rooms assigned to its badge, and no agent may approve an exception or execute a vendor bank change." },
    });
});

const callContext = () => ({
  client: { type: "business" as const, phoneNumber: "+15555550100", dnc: false,
    localWeekday: 1, localHour: 9,
    consent: { source: "signup", text: "I consent to AI calls", timestamp: "2026-10-23T12:00:00Z", number: "+15555550100" } },
});

describe("call permits", () => {
  it.each([
    ["CONSENT_REQUIRED", { client: { ...callContext().client, consent: undefined } }, "DENY"],
    ["B2B_ONLY_CALLS", { client: { ...callContext().client, type: "consumer" } }, "DENY"],
    ["CALL_WINDOW", { client: { ...callContext().client, localHour: 18 } }, "DENY"],
    ["DNC", { client: { ...callContext().client, dnc: true } }, "DENY"],
    ["OFAC_STOP", { signals: { ofacHit: true } }, "ESCALATE"],
    ["CLOSED_BUSINESS_STOP", { signals: { closedBusiness: true } }, "ESCALATE"],
    ["BANKRUPTCY_STOP", { signals: { bankruptcy: true } }, "ESCALATE"],
    ["DISPUTE_STOP", { signals: { disputed: true } }, "ESCALATE"],
  ] as const)("enforces %s", (rule, patch, kind) => {
    const result = evaluate("collections", { type: "call_client" }, { ...callContext(), ...patch } as Parameters<typeof evaluate>[2]);
    expect(result).toMatchObject({ kind, ruleIds: [rule], policyVersion: 1 });
    if (result.kind === "ESCALATE") expect(result.toHuman).toBe("Dana");
  });
  it.each([[1, 9], [5, 17.99]])("allows weekday %s at hour %s", (localWeekday, localHour) => {
    expect(evaluate("collections", { type: "call_client" }, { client: { ...callContext().client, localWeekday, localHour } }).kind).toBe("ALLOW");
  });
  it("logs DEMO_OVERRIDE only for a visible, logged calling-hours bypass", () => {
    expect(evaluate("collections", { type: "call_client" }, {
      client: { ...callContext().client, localWeekday: 0 }, demoOverride: { visible: true, logged: true },
    })).toMatchObject({ kind: "ALLOW", ruleIds: ["IN_BADGE", "DEMO_OVERRIDE"] });
  });
});

const validPlan: Plan = { installments: 2, firstPaymentPct: 50, totalDays: 30, waiveFees: false, discountPct: 0 };
const planContext = { identityConfirmed: true };
describe("Collections envelope", () => {
  it.each([
    ["MAX_INSTALLMENTS", { installments: 4 }, "ESCALATE"],
    ["MIN_FIRST_PCT", { firstPaymentPct: 49 }, "ESCALATE"],
    ["MAX_PLAN_DAYS", { totalDays: 31 }, "ESCALATE"],
    ["FEES_NON_WAIVABLE", { waiveFees: true }, "DENY"],
    ["MAX_DISCOUNT", { discountPct: 1 }, "ESCALATE"],
  ] as const)("enforces %s", (rule, patch, kind) => {
    expect(evaluate("collections", { type: "propose_plan", plan: { ...validPlan, ...patch } }, planContext))
      .toMatchObject({ kind, ruleIds: [rule] });
  });
  it("accepts the exact envelope and pay in full", () => {
    for (const plan of [validPlan, { ...validPlan, installments: 1, firstPaymentPct: 100, totalDays: 0 }]) {
      expect(evaluate("collections", { type: "propose_plan", plan }, planContext).kind).toBe("ALLOW");
    }
  });
  it("reads an updated maximum next call without a prompt change", () => {
    const policy = structuredClone(DEFAULT_POLICY);
    const action = { type: "propose_plan" as const, plan: { ...validPlan, installments: 3 } };
    expect(evaluate("collections", action, { ...planContext, policy }).kind).toBe("ESCALATE");
    const draft = structuredClone(policy);
    draft.badges.collections.limits.maxInstallments = 3;
    const saved = savePolicy(policy, draft);
    expect(evaluate("collections", action, { ...planContext, policy: saved })).toMatchObject({ kind: "ALLOW", policyVersion: 2 });
  });
  it("withholds details and offers until identity is confirmed", () => {
    expect(evaluate("collections", { type: "get_invoice_context" }, {})).toMatchObject({ kind: "DENY", ruleIds: ["IDENTITY_REQUIRED"] });
    expect(evaluate("collections", { type: "disclose_invoice" }, {})).toMatchObject({ kind: "DENY", ruleIds: ["IDENTITY_REQUIRED"] });
    expect(evaluate("collections", { type: "propose_plan", plan: validPlan }, {})).toMatchObject({ kind: "DENY", ruleIds: ["IDENTITY_REQUIRED"] });
  });
  it("computes the first-payment link from principal plus late fees", () => {
    const context = { ...planContext, receivable: { principalCents: 480000, lateFeeCents: 15000 } };
    expect(evaluate("collections", { type: "send_payment_link", plan: validPlan, amountCents: 247500 }, context).kind).toBe("ALLOW");
    expect(evaluate("collections", { type: "send_payment_link", plan: validPlan, amountCents: 240000 }, context))
      .toMatchObject({ kind: "DENY", ruleIds: ["LINK_AMOUNT"] });
  });
  it("rounds a fractional-dollar first payment up to the next whole dollar, never above the total", () => {
    expect(firstPaymentCents(495000, 15, 7)).toBe(74300);
    expect(firstPaymentCents(495000, 50, 2)).toBe(247500);
    expect(firstPaymentCents(495050, 100, 1)).toBe(495050);
    const context = { ...planContext, receivable: { principalCents: 480000, lateFeeCents: 15000 } };
    const plan = { ...validPlan, firstPaymentPct: 55 };
    const decide = (amountCents: number) => evaluate("collections", { type: "send_payment_link", plan, amountCents }, context);
    expect(decide(272300).kind).toBe("ALLOW");
    expect(decide(272250)).toMatchObject({ kind: "DENY", ruleIds: ["LINK_AMOUNT"] });
  });
});

const vendor = { id: "north", inMaster: true, approved: true, pendingBankChange: false, knownDomain: "northfield.com" };
const invoice = { id: "4419", vendorId: "north", amountCents: 150000,
  lineItems: [{ description: "Design", quantity: 1, unitPriceCents: 150000 }], poMatched: true, account: "operating" };
describe("Payables", () => {
  it.each([
    ["OVER_LIMIT", { ...invoice, amountCents: 200001 }, {}, "ESCALATE"],
    ["NO_PO", { ...invoice, poMatched: false }, {}, "ESCALATE"],
    ["OPERATING_ACCOUNT_ONLY", { ...invoice, account: "treasury" }, {}, "DENY"],
    ["PAYEE_NOT_IN_MASTER", invoice, { vendor: { ...vendor, inMaster: false } }, "ESCALATE"],
    ["PAYEE_NOT_IN_MASTER", invoice, { vendor: { ...vendor, approved: false } }, "ESCALATE"],
    ["BANK_CHANGE_HOLD", invoice, { vendor: { ...vendor, pendingBankChange: true } }, "ESCALATE"],
    ["LOOKALIKE_DOMAIN", invoice, { vendor: { ...vendor, sourceDomain: "northfie1d.com" } }, "ESCALATE"],
    ["DUPLICATE_INVOICE", { ...invoice, amountCents: 153700 }, { priorInvoices: [{ ...invoice, id: "4402" }] }, "ESCALATE"],
  ] as const)("enforces %s", (rule, candidate, patch, kind) => {
    expect(evaluate("payables", { type: "pay_invoice", invoice: candidate }, { vendor, ...patch }))
      .toMatchObject({ kind, ruleIds: [rule], policyVersion: 1 });
  });
  it("allows an approved vendor at exactly $2,000 with a PO", () => {
    expect(evaluate("payables", { type: "pay_invoice", invoice: { ...invoice, amountCents: 200000 } }, { vendor }).kind).toBe("ALLOW");
  });
  it("holds legitimate bank changes and refuses agent bank writes or onboarding payments", () => {
    expect(evaluate("vendor_onboarding", { type: "propose_bank_change", emailDomain: "northfield.com" }, { vendor }))
      .toMatchObject({ kind: "ESCALATE", ruleIds: ["BANK_CHANGE_HOLD"] });
    expect(evaluate("vendor_onboarding", { type: "pay_invoice", invoice }, { vendor }))
      .toMatchObject({ kind: "DENY", ruleIds: ["NOT_IN_BADGE"] });
    expect(evaluate("payables", { type: "propose_bank_change", emailDomain: "northfield.com" }, { vendor }))
      .toMatchObject({ kind: "DENY", ruleIds: ["NOT_IN_BADGE"] });
  });
});

it("does not treat malformed local time as a demo-hours exception", () => {
  expect(evaluate("collections", { type: "call_client" }, {
    client: { ...callContext().client, localHour: Number.NaN }, demoOverride: { visible: true, logged: true },
  })).toMatchObject({ kind: "DENY", ruleIds: ["INVALID_INPUT"] });
});

it("excludes the current invoice from prior-duplicate checks", () => {
  expect(evaluate("payables", { type: "pay_invoice", invoice }, { vendor, priorInvoices: [invoice] }).kind).toBe("ALLOW");
});

describe("boundary and fail-closed cases", () => {
  it.each([[0, 12], [6, 12], [1, 8.99], [5, 18]])("blocks weekday %s at hour %s", (localWeekday, localHour) => {
    expect(evaluate("collections", { type: "call_client" }, { client: { ...callContext().client, localWeekday, localHour } }))
      .toMatchObject({ kind: "DENY", ruleIds: ["CALL_WINDOW"] });
  });
  it.each(["source", "text", "timestamp", "number"] as const)("requires consent %s", field => {
    const context = callContext();
    context.client.consent[field] = "";
    expect(evaluate("collections", { type: "call_client" }, context)).toMatchObject({ kind: "DENY", ruleIds: ["CONSENT_REQUIRED"] });
  });
  it.each(["not-a-date", " "])("rejects consent timestamp %s", timestamp => {
    const context = callContext();
    context.client.consent.timestamp = timestamp;
    expect(evaluate("collections", { type: "call_client" }, context).kind).toBe("DENY");
  });
  it("requires consent for the number being dialed", () => {
    const context = callContext();
    context.client.phoneNumber = "+15555559999";
    expect(evaluate("collections", { type: "call_client" }, context)).toMatchObject({ kind: "DENY", ruleIds: ["CONSENT_REQUIRED"] });
  });
  it.each([
    { client: { ...callContext().client, consent: undefined } },
    { client: { ...callContext().client, type: "consumer" as const } },
    { client: { ...callContext().client, dnc: true } },
    { signals: { ofacHit: true } }, { signals: { closedBusiness: true } },
    { signals: { bankruptcy: true } }, { signals: { disputed: true } },
  ])("demo override never bypasses another safeguard %#", patch => {
    expect(evaluate("collections", { type: "call_client" }, {
      ...callContext(), ...patch, demoOverride: { visible: true, logged: true },
    }).kind).not.toBe("ALLOW");
  });
  it.each([{ visible: true, logged: false }, { visible: false, logged: true }])("requires both override receipts %#", demoOverride => {
    expect(evaluate("collections", { type: "call_client" }, {
      client: { ...callContext().client, localWeekday: 0 }, demoOverride,
    })).toMatchObject({ kind: "DENY", ruleIds: ["CALL_WINDOW"] });
  });
  it.each([
    { installments: 0 }, { installments: 1.5 }, { firstPaymentPct: Number.NaN },
    { firstPaymentPct: -1 }, { firstPaymentPct: 101 }, { totalDays: -1 },
    { totalDays: 0.5 }, { discountPct: -1 }, { discountPct: Number.NaN },
    { installments: 1 }, { firstPaymentPct: 100 },
  ])("rejects malformed plan %#", patch => {
    expect(evaluate("collections", { type: "propose_plan", plan: { ...validPlan, ...patch } }, planContext))
      .toMatchObject({ kind: "DENY", ruleIds: ["INVALID_INPUT"] });
  });
  it.each(["ofacHit", "closedBusiness", "bankruptcy", "disputed"] as const)("stops offers and links for %s", signal => {
    const context = { ...planContext, signals: { [signal]: true }, receivable: { principalCents: 480000, lateFeeCents: 15000 } };
    expect(evaluate("collections", { type: "propose_plan", plan: validPlan }, context).kind).toBe("ESCALATE");
    expect(evaluate("collections", { type: "send_payment_link", plan: validPlan, amountCents: 247500 }, context).kind).toBe("ESCALATE");
  });
  it("enforces room ownership and refuses Treasury", () => {
    expect(evaluate("collections", { type: "enter_room", room: "collections" }, {}).kind).toBe("ALLOW");
    for (const room of ["payables", "vendor_onboarding", "treasury"]) {
      expect(evaluate("collections", { type: "enter_room", room }, {})).toMatchObject({ kind: "DENY", ruleIds: ["NOT_IN_BADGE"] });
    }
  });
  it("rejects a stale requested policy version", () => {
    expect(evaluate("collections", { type: "read_ar" }, { policyVersion: 2 })).toMatchObject({ kind: "DENY", ruleIds: ["INVALID_INPUT"], policyVersion: 1 });
  });
});

describe("AP fuzzy boundaries", () => {
  it.each([
    ["NORTHFIELD.COM.", "ALLOW"], ["northfieldd.com", "ESCALATE"],
    ["northfild.co", "ESCALATE"], ["n0rthfie1d.com", "ESCALATE"],
    ["nortfhield.com", "ESCALATE"], ["unrelated.com", "ALLOW"],
  ] as const)("classifies sender domain %s", (sourceDomain, kind) => {
    const result = evaluate("payables", { type: "pay_invoice", invoice }, { vendor: { ...vendor, sourceDomain } });
    expect(result.kind).toBe(kind);
    if (kind === "ESCALATE") expect(result.ruleIds).toEqual(["LOOKALIKE_DOMAIN"]);
  });
  it.each([
    [50000, 60000, "DUPLICATE_INVOICE"], [50000, 60001, "IN_BADGE"],
    [150000, 140000, "DUPLICATE_INVOICE"], [150000, 139999, "IN_BADGE"],
    [1000000, 1050000, "DUPLICATE_INVOICE"], [1000000, 1050001, "OVER_LIMIT"],
    [1000000, 950000, "DUPLICATE_INVOICE"], [1000000, 949999, "OVER_LIMIT"],
  ])("compares prior %s cents to %s cents", (before, after, rule) => {
    const result = evaluate("payables", { type: "pay_invoice", invoice: { ...invoice, amountCents: after as number } }, {
      vendor, priorInvoices: [{ ...invoice, id: "4402", amountCents: before as number }],
    });
    expect(result.ruleIds).toEqual([rule]);
  });
  it("requires the same vendor and line-item quantities, independent of order", () => {
    const prior = { ...invoice, id: "4402", lineItems: [...invoice.lineItems, { description: "Hosting", quantity: 2, unitPriceCents: 100 }] };
    const candidate = { ...prior, id: "4419", lineItems: [...prior.lineItems].reverse() };
    expect(evaluate("payables", { type: "pay_invoice", invoice: candidate }, { vendor, priorInvoices: [prior] }).ruleIds).toEqual(["DUPLICATE_INVOICE"]);
    expect(evaluate("payables", { type: "pay_invoice", invoice: candidate }, { vendor, priorInvoices: [{ ...prior, vendorId: "other" }] }).kind).toBe("ALLOW");
    expect(evaluate("payables", { type: "pay_invoice", invoice: candidate }, { vendor, priorInvoices: [{ ...prior, lineItems: [{ description: "Hosting", quantity: 3, unitPriceCents: 100 }] }] }).kind).toBe("ALLOW");
  });
});

it("fails closed for unknown dispatcher actions without a compile-time migration", () => {
  expect(evaluate("collections", { type: "noop" }, {})).toMatchObject({ kind: "DENY", ruleIds: ["NOT_IN_BADGE"] });
  expect(evaluate("collections", { type: "approve_exception" }, {})).toMatchObject({ kind: "DENY", ruleIds: ["NOT_IN_BADGE"] });
});

it("rejects malformed dispatcher payloads and inherited badge names", () => {
  expect(evaluate("payables", { type: "pay_invoice", invoice: { ...invoice, lineItems: [null] } }, { vendor }))
    .toMatchObject({ kind: "DENY", ruleIds: ["INVALID_INPUT"] });
  expect(evaluate("vendor_onboarding", { type: "propose_bank_change" }, { vendor }))
    .toMatchObject({ kind: "DENY", ruleIds: ["INVALID_INPUT"] });
  expect(evaluate("__proto__" as Parameters<typeof evaluate>[0], { type: "read_ar" }, {}))
    .toMatchObject({ kind: "DENY", ruleIds: ["NOT_IN_BADGE"] });
});
