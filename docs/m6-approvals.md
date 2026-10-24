# M6: controller review during the call

`/controller` enrolls Dana. `/approve/[id]` displays the immutable escalation
snapshot and confirms Approve, Deny, or Counter with a passkey. This is a mobile
web route, independent of the office renderer. No model or paid provider is used.

## Setup

Node 22+ is required by SimpleWebAuthn 14. Set these **server-only** variables:

- `WEBAUTHN_ORIGIN`: exact origin, such as `https://backroom.example.com`; no trailing slash.
- `WEBAUTHN_RP_ID`: its hostname, without protocol or port.
- `CONTROLLER_ENROLLMENT_SECRET`: a private random code, distinct from the voice tool secret.
- `TOOL_GATEWAY_SECRET`: existing gateway bearer secret.

On localhost, use `WEBAUTHN_ORIGIN=http://localhost:3000` and
`WEBAUTHN_RP_ID=localhost`. Physical phones need HTTPS at the configured origin.
Next reads `web/.env.local`; when the team's keys are in the repository-root
`.env.local`, export them into the server process through your existing launcher.
Do not copy real values into this document or a client-side variable.

Visit `/controller` **before** the call, enter the private enrollment code, and
create Dana's passkey. The server verifies registration, requires user
verification, and stores only the public credential, credential id, transports,
and counter. A second registration cannot replace Dana in this process.
Biometrics and private keys remain in the authenticator. There is no voice or
text approval route, and the voice tool allowlist excludes `decide_escalation`.

The optional `BACKROOM_APPROVAL_DEMO=1` startup fixture seeds only a synthetic
`approval-demo` call (invoice 1042, $4,800 principal + $150 fee). It never dials,
sends email, or calls a bank. This is off by default. Trusted live ingress must
still install a populated `GatewayStore` via `installGatewayStore`.

## Live controller inbox (no links on the call)

After enrollment Dana taps **Sign in with passkey** on `/controller` and leaves the
page open on her phone. It polls `GET /api/controller/inbox` every 1.5 s; when the
gateway raises an escalation for her, the page chimes, vibrates where the browser
supports it (not iOS Safari), and opens the approval card in place with the same
evidence and decide path as `/approve/[id]`. Nobody relays a link. A newer request
waits in an "Also waiting" queue instead of replacing a card Dana is reviewing.
The page asks for a screen wake lock; iOS plays the chime only after a tap, which
the sign-in tap provides (a "Tap to turn on the request chime" button covers reloads).

The sign-in is a passkey assertion bound to a `session` challenge. It sets an
`HttpOnly; SameSite=Strict` cookie (`Secure` on HTTPS) scoped to `/api/controller`,
valid 12 hours, process-local like the credential. The session only lists pending
requests: it cannot decide one, a sign-in assertion cannot be spent as a decision,
and every Approve/Deny/Counter still needs its own decision-bound assertion. The inbox
lists escalations created through `createApprovalBridge` (every gateway
`propose_plan` ESCALATE, including the demo seed and a caller's one re-ask) in this
server process, while they are `pending`; an `expired` row leaves the list. Intake and
payment-review escalations still need their link. Web Push is not wired: the page
must stay open in the foreground.

## Contracts for state, voice and the office

- `@backroom/orchestrator` exports `ControllerApprovals`, `ControllerDecision`,
  `ApprovalTerms`, `StateStore`, and `MemoryStateStore`.
- `StateStore.createEscalation` creates the worker row and sets the desk target
  atomically. `createCallEscalation` is the trusted gateway ingress for persisted
  call evidence. Gateway `ESCALATE` responses now include `approval_path`.
- The gateway copies policy rule ids, the exact quoted policy sentence/version,
  audit + invoice refs, money, and requested terms into the row synchronously
  before returning `ESCALATE`. Amounts and policy never come from caller speech.
- Gateway calls may supply trusted `agentId`. Without it, their agent id is
  `collections:<callId>`. The desk target preserves the existing worker contract,
  `Dana_desk` (`${toHuman}_desk`); the office adapter maps that to its `dana`
  anchor. `getAgent(id)` and `getEscalation(id)` are the read interfaces. The
  renderer never decides or authenticates anything.
- `decideEscalation(VerifiedApproval, now)` consumes a one-use server capability.
  Only the WebAuthn verifier mints it. Durable server adapters can use exported
  `consumeVerifiedApproval`; never replace it with a caller-supplied boolean.
- Status is `pending | approved | denied | counter | pending_owner | expired`. Decisions
  are `{ kind: 'Approve' | 'Deny' }` or `{ kind: 'Counter', terms: ApprovalTerms }`.
  A verified decision carries `method: 'passkey'`, `decidedAt` and credential id.
- `check_approval` reads this call's StateStore row and returns `approval_status`,
  `decision`, and `counter_terms` when applicable. It still returns
  `can_confirm: false`: controller review does not create an ALLOW, execute a
  payment, or bypass a fresh policy check. The voice owner relays the recorded
  result. Applying an exception to a new committed plan remains a separately
  policy-checked controller action.
- A live call (`callId` set) stays `pending` for the call, up to
  `APPROVAL_WINDOW_MS` (default 300000, maximum 900000). It also closes when the
  voice relay reports `call_completed` or `call_failed`. That status is
  `expired`, with one `escalation_expired` audit. `check_approval` returns
  `approval_status: "expired"` and `may_reask: true`. If the caller asks to send
  the same terms again, `propose_plan` opens exactly one fresh row. A second
  fresh row is refused (`ESCALATION_RETRY_USED`), and a second open row is
  refused (`ESCALATION_OPEN`). Voice cannot approve. On an open call,
  `check_approval` never says Dana will confirm by email. Rows with no `callId`
  still close at 60 seconds as `pending_owner`. When a live call ends, a
  matching AR invoice in `in_collection`/`escalated` moves to `pending_owner`,
  including a row that already expired during the call. That follow-up is
  written once and does not repeat `escalation_expired`.
  Reads, gateway polls and the call-end hook enforce expiry; no browser timer
  is trusted. Late assertions cannot approve an `expired` row. The approval
  card's after-call `pending_owner` line remains “Dana will confirm by email
  today.” That records follow-up; it does not send email.

The HTTP surface is `GET /api/approvals/:id/view`,
`GET /api/controller/inbox` (signed-in session only), `POST /api/controller/session-options`
(`{}`) and `/session` (`{ challengeId, response }`),
`POST /api/approvals/:id/options` (`{ decision }`), and
`POST /api/approvals/:id/decide` (`{ challengeId, response }`). Enrollment uses
`POST /api/controller/register-options` and `/register`, both with the enrollment
secret. POST origin must match the configured origin. Responses are uncached.
Challenges are random, expire in 60 seconds, bind one escalation and exact saved
decision/counter terms, and are consumed before async verification. Assertions
must match RP, origin, credential id and user verification. Credential counters
are updated. No claimed `verified` or `method` flag grants authority.

**Current persistence boundary:** all approval credentials, challenges and
StateStore rows are process-local and lost on restart. Run one server process
for the rehearsal. They are shared across Next route chunks/dev reloads, not
across machines or serverless instances. `installApprovalStateStore` must run at
trusted bootstrap before starting the controller service; it delegates to the
shared `installStateStore` used by the router and OFF control. Approvals remain
available with model work OFF. SpacetimeDB wiring
must persist credentials/challenges and atomically consume verified decisions,
expiry, evidence and audit writes; merely swapping the row adapter is insufficient.
The gateway store and approval store also need a common transaction/outbox for
multi-instance durability. No live call, real phone biometrics, production
persistence or rendered office walk is claimed by the local tests.

## Verification

Checked against maintained [server](https://simplewebauthn.dev/docs/packages/server)
and [browser](https://simplewebauthn.dev/docs/packages/browser) documentation,
Oct 24, 2026; installed server 14.0.3 and browser 14.0.0.

```sh
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm -r build
# Opt-in browser check; no signed-in Chrome or external providers:
PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright" pnpm --filter @backroom/web exec playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/.playwright" pnpm --filter @backroom/web test:approvals:browser
```

The browser check starts its own production Next server at localhost:3020 with
synthetic call data. It enrolls a Chromium virtual authenticator, checks a
390px-wide phone page for overflow, verifies Deny/Approve/Counter reach
`check_approval`, rejects a forged assertion and replays each real assertion to
confirm rejection. It records `web/test-results/approval-mobile.png` (ignored).
It also checks each local gateway escalation response completes in under 1 s.

Focused Vitest coverage: real P-256 signatures through the installed verifier;
private enrollment and replacement rejection; wrong origin/RP/signature/UV;
missing assertion; assertion races and replay; cross-escalation challenge reuse;
immutable counter terms; forged voice/text claims; live-call window and call-end expiry; one re-ask then a refusal;
worker row + target creation without 3D; HTTP origin/enrollment boundaries;
real gateway evidence and timeout relay. No network is mocked because these
paths make no external network requests. Existing policy/gateway suites remain.
