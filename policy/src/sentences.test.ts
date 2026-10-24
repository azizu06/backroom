import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { POLICY_SENTENCES, RULE_SENTENCES, evaluate } from "./index";

const ownerDocument = new URL("../../fixtures/policy/northfield-policy.md", import.meta.url);
it("maps every rule to exactly one exact sentence in the owner document", () => {
  expect(existsSync(ownerDocument)).toBe(true);
  const lines = readFileSync(ownerDocument, "utf8").split("\n");
  const entries = lines.flatMap(line => {
    const match = /^\[(NF-\d{3})\] (.+)$/.exec(line);
    return match ? [[match[1]!, match[2]!] as const] : [];
  });
  expect(entries).toHaveLength(Object.keys(POLICY_SENTENCES).length);
  const sentences = Object.fromEntries(entries);
  expect(sentences).toEqual(POLICY_SENTENCES);
  expect(new Set(Object.values(RULE_SENTENCES)).size).toBe(Object.keys(RULE_SENTENCES).length);
  for (const sentenceId of Object.values(RULE_SENTENCES)) {
    expect(sentences[sentenceId], sentenceId).toBeTruthy();
  }
  const decision = evaluate("collections", { type: "pay_invoice" }, {});
  expect(decision.kind).toBe("DENY");
  if (decision.kind !== "ALLOW") {
    expect(decision.quote.text).toBe(sentences[decision.quote.sentenceId]);
    expect(decision.reason).toContain(decision.quote.text);
  }
});

it('keeps the frozen owner quote and annotates saved numeric limits honestly', async () => {
  const { DEFAULT_POLICY, savePolicy } = await import('./index');
  const draft = structuredClone(DEFAULT_POLICY);
  draft.badges.collections.limits.maxInstallments = 3;
  const policy = savePolicy(DEFAULT_POLICY, draft);
  const decision = evaluate('collections', { type: 'propose_plan', plan: { installments: 4, firstPaymentPct: 50, totalDays: 30, waiveFees: false, discountPct: 0 } }, { policy, identityConfirmed: true });
  expect(decision.kind).toBe('ESCALATE');
  if (decision.kind !== 'ALLOW') {
    expect(decision.quote.text).toBe(`${POLICY_SENTENCES['NF-012']} Saved maximum installment count: 3 in v2.`);
    expect(decision.reason).toContain('3 in v2');
  }
});
