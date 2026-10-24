/** Real policy replay over shipped data. This deliberately does not fake provider/reducer proof. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "../../policy/src/index";
import type { ActionRequest, Badge, Context } from "../../policy/src/types";

const fixtureRoot = process.env.FIXTURE_ROOT
  ? resolve(process.env.FIXTURE_ROOT)
  : fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(resolve(fixtureRoot, path), "utf8"));
const seed = read("company/northfield.json");
const payables = read("scenarios/payables.json");
const collections = read("scenarios/collections.json");
const key = read("answer-key/expected.json");
let passed = 0;
let integrationOnly = 0;

function verify(label: string, badge: Badge, action: ActionRequest, context: Context, expected: { kind: string; ruleIds: string[] }) {
  const result = evaluate(badge, action, context);
  assert.equal(result.kind, expected.kind, `${label}: ${JSON.stringify(result)}`);
  assert.deepEqual(result.ruleIds, expected.ruleIds, label);
  assert.equal(result.policyVersion, 1, label);
  if (result.kind !== "ALLOW") {
    assert.ok(result.quote.sentenceId.startsWith("NF-"), label);
    assert.ok(result.reason.includes(result.quote.text), label);
  }
  passed++;
}

for (const scenario of payables) {
  const keySteps = key.payables[scenario.id].expectedSteps;
  assert.equal(keySteps.length, scenario.steps.length, scenario.id);
  for (const [index, step] of scenario.steps.entries()) {
    const keyStep = keySteps[index];
    if (step.verificationLayer === "integration") {
      assert.equal(keyStep.integrationOutcome, step.operation, scenario.id);
      integrationOnly++;
      continue;
    }
    const invoice = seed.apInvoices.find((i: any) => i.id === step.invoiceId);
    const vendor = seed.vendors.find((v: any) => v.id === (step.vendorId ?? invoice?.vendorId));
    const context: Context = {
      vendor: { ...vendor, ...step.vendorOverrides },
      priorInvoices: (step.priorInvoiceIds ?? []).map((id: string) => seed.apInvoices.find((i: any) => i.id === id)),
      signals: step.signals,
    };
    const action = step.action === "pay_invoice"
      ? { type: step.action, invoice }
      : { type: step.action, emailDomain: step.emailDomain };
    verify(`${scenario.id}/${index}`, step.badge, action, context, keyStep);
  }
}

for (const scenario of collections) {
  const keySteps = key.collections[scenario.id].expectedSteps;
  assert.equal(keySteps.length, scenario.steps.length, scenario.id);
  const invoice = seed.arInvoices.find((i: any) => i.id === scenario.invoiceId);
  const client = seed.clients.find((c: any) => c.id === invoice.clientId);
  for (const [index, step] of scenario.steps.entries()) {
    const keyStep = keySteps[index];
    if (step.verificationLayer === "integration") {
      assert.equal(keyStep.integrationOutcome, step.operation, scenario.id);
      integrationOnly++;
      continue;
    }
    const overrides = step.contextOverrides;
    const context: Context = {
      identityConfirmed: true,
      receivable: { principalCents: invoice.principalCents, lateFeeCents: invoice.lateFeeCents },
      ...overrides,
      client: { ...client, localWeekday: 2, localHour: 11, ...overrides.client },
    };
    verify(`${scenario.id}/${index}`, step.badge, step.actionRequest, context, keyStep);
  }
}
console.log(`PASS: ${passed} policy decisions against actual @backroom/policy; ${integrationOnly} integration steps declared, not executed.`);
