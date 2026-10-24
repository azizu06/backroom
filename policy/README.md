# @backroom/policy

Pure TypeScript: no network, database, environment variables, model, wall clock,
or UI dependency. Import the package root. `src/types.ts` is the public type
contract; `src/northfield.json` is the versioned owner configuration.

```ts
import { DEFAULT_POLICY, evaluate, computeEnvelope, savePolicy } from "@backroom/policy";

const draft = structuredClone(DEFAULT_POLICY);
draft.badges.collections.limits.maxInstallments = 3;
const saved = savePolicy(DEFAULT_POLICY, draft); // new JSON object, version 2
const envelope = computeEnvelope(saved, ["health_check_pending"]);
const decision = evaluate("collections", {
  type: "propose_plan",
  plan: { installments: 3, firstPaymentPct: 50, totalDays: 30, waiveFees: false, discountPct: 0 },
}, { policy: saved, identityConfirmed: true }); // ALLOW, policyVersion 2
```

## Entry points

| Export | Contract |
| --- | --- |
| `evaluate(badge, action, context): Decision` | First failing rule wins; never mutates inputs; checks before side effects. |
| `savePolicy(previous, draft): Policy` | Validates, clones JSON, and increments the persisted version on **every** save, even a no-op; ignores any draft version; throws on invalid policy or exhausted version. Persist atomically with a compare-and-set on `previous.policyVersion`. |
| `computeEnvelope(policy?, activeSignals?): CollectionEnvelope` | Pay in full, or up to the saved installment count with the saved first percentage and duration; defaults to 2 / 50% / 30 days, fees retained, 0 discount. Invalid policy throws. |
| `DEFAULT_POLICY` | Deeply frozen Northfield version 1; clone before editing. |
| `RULE_SENTENCES`, `POLICY_SENTENCES`, `RuleId` | Stable rule-to-sentence mapping and exact runtime quote text. |

`Badge` is `collections | payables | vendor_onboarding`. `Action` is a
small discriminated union. The evaluator also accepts an unchecked `ActionRequest`
from a dispatcher for compatibility; validate tool schemas at the HTTP boundary.
Unknown actions or another badge's actions/rooms
receive `DENY / NOT_IN_BADGE`. Saved settings may remove capabilities but cannot
grant another badge's capabilities, Treasury access, approvals, or bank writes.
Amounts are integer **cents**; percentages use **0–100**, not fractions.

## Context and trust boundary

`Context.policy` supplies the current saved policy; omitting it selects bundled
version 1. Optional `policyVersion` is a stale-version guard, not a selector for
historical settings. All results cite the actual evaluated policy version.

The caller must populate context from trusted state, not model output:

- `client`: business/consumer, target phone, complete consent record, DNC, and
  current client-local weekday (Sunday = 0) and hour (fractional allowed).
- `signals`: OFAC, closed business, bankruptcy, dispute, and active names from
  the owner's `signalAdjustments` table. Unknown signal names do nothing.
- `identityConfirmed`: verified identity result. `get_invoice_context`,
  `disclose_invoice`, `propose_plan`, and `send_payment_link` require it.
  Internal pre-call planning uses `read_ar`; do not expose that data to speech.
- `vendor`: stable id, approved/in-master flags, pending bank change, known
  domain and optional sender domain (hostnames only, no URL/email address).
- `priorInvoices`: prior AP records. The current invoice's same id is excluded;
  different ids with matching vendor, normalized descriptions and quantities
  (order independent) are compared by total. A difference at most 5% of the
  prior total **or** $100 is a duplicate, including both inclusive boundaries.
- `receivable`: principal and late fee for a first-payment link. The engine
  applies any permitted principal discount, adds retained fees, then rounds
  the first percentage to cents. The requested `amountCents` must match.

Default calling hours are weekdays 09:00 inclusive–18:00 exclusive. Only
`demoOverride: { visible: true, logged: true }` bypasses hours, citing
`DEMO_OVERRIDE`; the caller must actually display and persist those receipts.
It never bypasses consent, business-only, DNC, sanctions, closure, bankruptcy,
or dispute checks. Those last four risk flags also stop offers/links; OFAC
also stops AP payments. Opt-out/dispute/human-handoff recording stays available
so the caller can persist the stop signal.

Signals use an owner-set adjustment table. Upper bounds use `min`, minimum
first payment uses `max`, and fee-waiver permission uses AND. Even a table entry
that attempts to widen a limit cannot widen the computed envelope. A plan can
still be escalated by the same limit rule after narrowing.

## Decisions, quotes, and integration

```ts
type Decision =
  | { kind: "ALLOW"; ruleIds: RuleId[]; policyVersion: number }
  | { kind: "DENY"; reason: string; ruleIds: RuleId[]; policyVersion: number;
      quote: { sentenceId: string; text: string } }
  | { kind: "ESCALATE"; reason: string; toHuman: string; ruleIds: RuleId[];
      policyVersion: number; quote: { sentenceId: string; text: string } };
```

Every blocked result contains one rule and its original sentence from
`fixtures/policy/northfield-policy.md`. Numeric-limit results after v1 append
the current saved limit and version; the frozen sentence remains verbatim.
See `docs/policy-editor.md` for the owner-save and state adapter contracts. `reason` is a code template that includes
the full quote and is ready for speech. Render `quote.text` and `sentenceId` on
the audit/approval UI, and persist the entire decision with the attempted action.
ALLOW cites `IN_BADGE`, plus `DEMO_OVERRIDE` or `SIGNALS_ONLY_NARROW` when used.
This package returns audit data; the orchestrator/reducers own audit writes.

Plan limit exceptions escalate to Dana; a prohibited fee waiver is denied.
AP holds escalate to Dana; an unauthorized account is denied. Valid bank-change
**proposals**, including legitimate ones, always escalate; no badge executes a
bank change or approves an exception. Human passkey approvals are a separate,
server-verified state transition and never a boolean supplied by a model to
this function. Re-run `evaluate` with fresh trusted context before a side effect;
SpacetimeDB reducers can import it if T8's bundle check permits.

The fixed AI/business/recording welcome, callback number, opt-out state writes,
CRS sandbox labels, and passkey verification remain caller responsibilities
under spec §1.4; this package enforces the permission checks, not transport.

Run `pnpm --filter @backroom/policy test` and
`pnpm --filter @backroom/policy typecheck`. Unit tests have no network or model
calls and enforce complete, exact sentence coverage for every exported rule.
