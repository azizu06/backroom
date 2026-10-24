# Owner policy editor (#11)

Open `/policy`. The owner can inspect all three badges and save four numeric
limits: Collections installment count, first-payment percentage and plan days,
and Payables maximum payment in **integer cents**. Every save creates a new
version, including a save with unchanged limits. Counts start at 1, days at 0,
percentage is 0–100, and payment cents start at 1; counts/days/cents must be safe
integers. Actions, rooms, fee permission, discounts and legal rules are read-only.

## Owner access

Set server-only `POLICY_DEMO_PIN` to a private value of at least 8 characters,
distinct from tool/voice/enrollment credentials. Set `POLICY_EDITOR_ORIGIN` to
the exact browser origin, or reuse `WEBAUTHN_ORIGIN`. Next loads `web/.env.local`;
export root `.env.local` variables through the launcher if using that file.
Do not put the PIN in client props or `NEXT_PUBLIC_*` variables.

The UI explicitly labels this as demo PIN protection. The existing passkey
controller binds assertions to an escalation and decision; it does not provide
a reusable login or an assertion for policy edits. This rehearsal uses the
permitted PIN fallback rather than claiming those assertions authorize edits.
The PIN remains in component memory only and is cleared by Lock/reload. Five
failed attempts lock this server handler for 60 seconds, including correct-PIN
requests during that interval. This is a single-owner rehearsal throttle.
Approvals and exceptions still require their existing passkey verification.

`GET /api/policy` and `POST /api/policy` require `x-policy-demo-pin`. POST also
requires the configured Origin and JSON `{expectedVersion, limits}` with exactly
the four numeric limit keys. Voice/gateway bearer credentials do not authorize
this endpoint; it is absent from all agent/voice tool schemas. Missing server
configuration fails closed. A stale save returns 409 without changing state or
writing an audit; reload explicitly discards the draft.

## State and decisions

`StateStore.getPolicy(version?)` returns detached immutable-version snapshots;
omitting the version returns the latest. `savePolicyLimits(expectedVersion,
limits, now)` is a **trusted owner reducer**, never an agent tool. Adapters must
atomically compare the current version, apply only the four allowed fields via
`@backroom/policy.savePolicy`, append the new snapshot, and append the human
`save_policy` audit with previous/new versions. Failed writes change neither.
The memory adapter preserves all historical versions and uses one synchronous
check/write section. Saved rows cite `method: demo_pin`; they never claim a passkey.

The Next gateway supplies `currentPolicy: () => getStateStore().getPolicy()` to
`createGateway` and refreshes the trusted policy/version before each new tool
invocation. Existing audits and escalation snapshots retain their original
versions. An older ALLOW cannot authorize a payment link under a newer version;
the existing exact-plan audit/version check rejects it. SeatWorker also reads
its StateStore's current policy before evaluating each step.

**Deployment boundary:** the bundled StateStore is process-local, like the
approval runtime, and loses all state on restart. Run the editor and Next tool
gateway in one process for this rehearsal. A separate voice relay, standalone
pre-call planner, PayablesSeat/VendorSeat integration, or another server must
consume a current trusted policy snapshot from the same durable state adapter;
merely importing the default fixture or starting a second MemoryStateStore does
not synchronize versions. Custom gateway bootstraps must bind `currentPolicy`.
This change does not claim cross-process SpacetimeDB persistence or a live call.

## Honest owner-document quotes (#12)

`fixtures/policy/northfield-policy.md` and its exact sentence mapping remain
frozen. For numeric-limit decisions in saved versions above v1, the policy
engine appends the current saved value/version to the original sentence, for
example `Saved maximum installment count: 3 in v2.` The original sentence says
“initially two”; it is not rewritten or presented as the current limit. The
same annotation applies to the minimum percentage, duration and Payables limit,
including ESCALATE and DENY evidence. Signal narrowing remains separate from
the saved owner limit.

## Verification

- Vitest: `orchestrator/src/policy-editor.test.ts`,
  `policy/src/sentences.test.ts`, `web/lib/policy-editor/http.test.ts`.
- Headless production Next check:
  `pnpm --filter @backroom/web build`, then
  `pnpm --filter @backroom/web exec playwright test --config playwright.policy.config.ts`.
- No model, telephony, bank, or other external service is called. The browser
  fixture reuses the explicitly synthetic `approval-demo` call.
- The browser proves v1 escalates three payments, owner save creates v2, and the
  next offer allows three. It verifies the hash-chain audits cite v1 then v2,
  saved quote annotations, HTML validation, persistence across page reload,
  lock behavior, and reachable mobile controls without horizontal overflow.

Headless screenshots: [v1](evidence/policy-editor/v1.png),
[v2](evidence/policy-editor/v2.png), [390px mobile](evidence/policy-editor/mobile.png).
