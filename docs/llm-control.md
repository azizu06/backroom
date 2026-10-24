# Global LLM control (#13)

`StateStore.llmEnabled` is the single global flag. The reference implementation
is in `orchestrator/src/memory-store.ts`; it defaults to ON and is process-local.
`setLlmEnabled(boolean)` flips the flag, appends a code audit, and aborts the old
`llmSignal`. ON creates a fresh signal so results from before OFF stay fenced.
Repeated writes of the same value are idempotent.

## Server wiring and #15 persistence

The package root exports `getStateStore`, `installStateStore`, `route`,
`createRouter`, `routeInboxItem`, and `createLlmControlHandler`. At server bootstrap,
`await installStateStore(adapter)` once, then pass `getStateStore()` to every
`SeatWorker`. The Next `/api/llm` route and default router use that same store.
Do not create an independent memory store for each request/worker. A separate
orchestrator process and Next process need the same durable adapter; separate
memory stores do **not** implement a cross-process switch.

For #15, map the flag to one SpacetimeDB `runtime_control` row, primary key
`global`, field `llmEnabled`. Implement its setter as an authenticated server
reducer with an atomic audit append. Subscription updates must immediately
abort the local `llmSignal` on OFF and replace it on ON. Stop model work while the
subscription is disconnected/stale; a cached ON is not authority. Persist the
`paused` task/agent state and implement `pauseTask` with the same fencing/lease
checks as the other task reducers. Resume paused tasks only on ON, rerunning
policy at the saved cursor. This PR defines that adapter contract; it does not
add a second state service or claim a durable SpacetimeDB implementation.

## Model and worker behavior

`route()` / `createRouter().route()` return `RouteResult<T> | LlmOffResult`.
Check `isLlmOff(result)` before using output. OFF returns
`{kind:'LLM_OFF', route:'code', model:'none', latencyMs:0, costUsd:0}` with no
model request, retry, or cloud fallback. OFF aborts in-flight requests; their
late results are discarded even if ON has already been restored. Cancellation
cannot undo provider work/spend already started before OFF. Health polling also
pauses while OFF. Ask-why now uses the router and returns cited code templates
when OFF, with the existing citation validation and correction retry when ON.

Workers always evaluate/audit policy before deciding whether to pause. Every
`dial` is model-dependent; producers can mark other steps `requiresModel:true`.
A permitted model-dependent step pauses at its cursor and releases its lease,
so new deterministic work in that seat can still be claimed. DENY and ESCALATE
remain active. New claims on ON reevaluate policy before executing. Effects must
honor `EffectRequest.signal`; a real voice adapter must cancel/end its remote
Cartesia call when aborted. Live Cartesia cancellation remains that adapter's
integration check, not something a local fetch abort can prove.

`routeInboxItem` always sends typed invoices/bank changes to Payables. For generic
emails, the router may suggest one of the three seats. On OFF or model failure,
code routes client messages to Collections and unclassified/vendor messages to
Vendor onboarding for triage. Routing grants no payment authority. AP decisions,
call permits, and gateway tools keep running. OFF worker completion/recovery,
routing and switch audits are `actor=code`; gateway decision audits always are.
Human approval records retain their actual attribution and passkey requirement.

## HTTP and unstyled component

`GET /api/llm` reads `{llmEnabled:boolean}`; `POST /api/llm` accepts exactly
`{llmEnabled:boolean}`. Both require `Authorization: Bearer <TOOL_GATEWAY_SECRET>`
and return `Cache-Control:no-store`. Missing configuration is 503; bad credentials
401; invalid JSON/body 400. The switch is server/controller authority, outside
Cartesia's tool allowlist.

`web/components/LlmToggle.tsx` exports a controlled, unstyled accessible switch
with `llmEnabled` and async `onToggle(enabled)` props. Diego can place it and bind
his authenticated controller transport, refreshing the prop from authoritative
state after success. Pending writes disable the button; errors do not fake a
successful flip. It is deliberately not mounted in the office in this PR.
Never pass the shared server secret through client props or `NEXT_PUBLIC_*`.

## Verification

`orchestrator/src/llm-off.test.ts` proves every router task is blocked with zero
network calls, OFF/ON fences in-flight output, voice pauses/cancels/resumes, inbox
fallback works, #4419 and #4471 stay held, legitimate bank changes stay held,
clean AP payments still execute, and OFF audit entries are code. Control tests
cover authenticated reads/writes and strict validation. Ask-why tests prove OFF
uses cited templates. Gateway tests verify code attribution.

Run `pnpm -r test`, `pnpm -r build`, and the gateway Vitest command in
`web/lib/gateway/README.md`. No paid/live model request is needed for these checks.
The existing router/why opt-in live scripts remain the only model smoke scripts.
