# Audit wall (Refs #23)

`/audit` mounts the reusable DOM `AuditWall` component. The lobby can mount it
alongside its canvas or inside a drei `Html` surface. It polls the installed
`getStateStore().listAudit()` every two seconds through `/api/audit/entries`.
The server verifies the **same complete snapshot** with `verifyChain()`; a broken
chain stays visible with `firstBrokenSeq`, while ask-why refuses it with 409.
Failed refreshes mark the previous chain status stale and disable asking.

## Access and data boundary

Configure the existing `WEBAUTHN_ORIGIN` and `CONTROLLER_ENROLLMENT_SECRET` variables
on the Next server. The private operator code opens an eight-hour signed,
HttpOnly, SameSite=Strict read session (Secure on HTTPS). It never reaches client
props, local storage, a URL, or a model. The browser submits its code only to
`POST /api/audit/session`. The session cookie is scoped to `/api/audit` and cannot
authorize gateway tools or passkey approval decisions. POST origins are checked
against deployment configuration. Audit reads and explanations require that
session and use `Cache-Control: no-store`.

This is a single-company demo access gate, reusing the existing controller
bootstrap code, not a multi-tenant identity system. The operator can inspect raw
recorded inputs; deploy behind operator access and never share the code publicly.
The installed reference StateStore remains process-local. An external core-demo
process does not populate this Next process; install the shared adapter at trusted
bootstrap for cross-process events. A valid unanchored hash chain cannot detect
removal of its valid suffix.

Replay shows saved inputs, rule evaluation, outcome, model metadata and hashes;
it never re-executes effects or evaluates historical inputs against today's policy.
Quotes come from the recorded decision. Escalation lifecycle rows may show a quote
from an explicitly referenced record with the same decision/rules/policy version,
with a clickable source citation. Missing policy evidence is stated explicitly.

`POST /api/audit/why` accepts a question, never browser-supplied evidence. It checks
a full snapshot before projecting recorded ALLOW/DENY/ESCALATE outcomes and the
allowlisted typed input fields into exported `createAskWhyHandler`. Unknown
outcomes are omitted; raw emails/invoices and other inputs never enter model
context. The existing ask-why module owns the shared router, LLM OFF handling,
validated citations and deterministic fallback. The UI labels model explanations,
code fallback and ungrounded answers separately. Cited ids open entry replay.

## Verification

From the repository root:

```sh
pnpm --filter @backroom/web exec vitest run lib/audit/http.test.ts
pnpm --filter @backroom/web build
pnpm --filter @backroom/web test:audit:browser
```

The headless test uses the existing opt-in `BACKROOM_APPROVAL_DEMO=1` synthetic
call, real gateway/policy/read routes, and no provider network. It records
screenshots in `docs/evidence/audit-wall/`. Tamper evidence intercepts a genuine
read response, changes one input and runs the real exported verifier before
rendering it. There is no production tamper/write endpoint. The HTTP unit test
separately proves a changed StateStore snapshot is rejected by ask-why.

The existing opt-in service smoke is `orchestrator/src/why/smoke.ts`; see that
module's README. No additional live service or paid smoke is introduced here.
