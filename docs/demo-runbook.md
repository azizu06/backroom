# Local demo operations (Refs #2)

This is the rehearsal host for spec §6.2, §6.3 and the three §8.2 dress rehearsals.
It is **local SpacetimeDB state + mock bank transport + synthetic, already verified caller**.
`STATE_STORE=memory` is available for tests/offline rehearsal.
The office subscribes to the selected StateStore in SpacetimeDB mode; memory
mode retains its labeled preview. The optional voice relay forwards tools to the
web host's gateway; external sponsor checks remain separate. Keep the rehearsal banner visible.

## Table-side recovery card

Start on the Mac first; bring the owned state server up before the web/orchestrator
host, then the optional voice relay. `demo:up` performs that order for you.
Run from the repo root, with private `.env.local` already configured:

```sh
DEMO_TUNNEL=0 pnpm demo:up  # local SpacetimeDB + mock bank, LLM OFF
pnpm demo:preflight        # six bounded read-only checks; exit 1 if any RED
pnpm demo:reset            # fresh DB, seed_company, scripted public gateway/reducer setup
```

For a phone passkey use `pnpm demo:up` with the default HTTPS tunnel instead.
Reset immediately before the pitch, reopen the printed approval/pay URLs, and
reload the office. The 60-second approval starts during reset. A fresh publish
can take longer than a few seconds: keep the labeled offline replay ready.
Stop only this worktree's host with `pnpm demo:down` before changing modes.

| Failure / RED row | Recovery at the table |
| --- | --- |
| Orchestrator | Inspect private `.demo/supervisor.log` and `.demo/web.log`; stop/start this owned host. Re-enroll the passkey if the origin changed. Never kill shared processes. |
| SpacetimeDB | Confirm the publisher config and CLI 2.13.0. Maincloud unavailable: stop and restart with `DEMO_SPACETIME=local`, retaining a local CLI. Last fallback: `STATE_STORE=memory DEMO_TUNNEL=0 pnpm demo:up`, visibly labeled preview. |
| Web | Use the printed port; close an unrelated listener only with its owner's permission, or select `DEMO_PORT=3300`. If only 3D fails, use 2D plan or `/audit`. |
| Cartesia | Continue the deterministic text take or labeled recorded voice; no automatic redial. A GREEN catalog read proves API access, not call readiness. |
| Nessie | Stop/start with `DEMO_LIVE=0` for the mock bank. Reset does not undo sandbox transactions; never replay an ambiguous payment. |
| GX10 Ollama | Keep the Mac host and set `DEMO_LLM=off` for the deterministic take. Cloud inference requires a separately verified opt-in route; preflight makes no inference. |

Preflight runs GETs in parallel (4-second provider timeouts), reads the owned
host's authenticated status (5-second timeout, including a StateStore policy
read), checks the web ping, Cartesia voice catalog, Nessie account and configured
Ollama model listing. It prints all six rows even when the host is down, with
no URLs, tokens or provider response bodies. Provider keys come from this
command's private environment; run it on the actual host with the same config.
Mock/memory/offline rehearsal intentionally leaves unused dependencies RED.
GREEN reachability does not claim a completed call, inference or deposit.

For GX10 deployment and a warm Mac fallback use [GX10 host operations](#gx10-production-host-and-warm-mac-fallback-refs-29-32).
Keep Anthropic credentials Mac-only; do not copy a Mac `.env.local` containing
them to GX10. Do not reset a shared host while another presenter is using it.

## Bring up / reset / shut down

Requires Node 22+, `pnpm install`, `cloudflared` on PATH, and SpacetimeDB CLI
**2.13.0**. Install it per `spacetime/README.md` or into `.demo/spacetime` with the
official installer. `SPACETIME_CLI` / `SPACETIME_ROOT` can select an existing install. Commands run from the
repo root. `.env.local` is loaded server-side; never copy its values into logs,
board posts, client props or screenshots. Retrieve the team env as documented in
AGENTS.md only if needed. No command here dials a phone.

```sh
pnpm demo:up           # local DB + publish/import, production web, seats, mock attack server, quick tunnel
pnpm demo:preflight    # six read-only reachability checks, nonzero on RED
pnpm demo:health       # local status + configured/missing; no external probes
pnpm demo:health --live # read-only, bounded GX10 /models, Nessie account, tunnel probes
pnpm demo:reset        # fresh local DB + scripted starting state; reprint fresh approve/pay links
pnpm demo:down         # stop only this supervisor's child process groups
```

`demo:up` stays alive through a detached, worktree-owned supervisor; the command
returns all URLs after readiness. Repeating it reuses this instance. The default
web listener is loopback port 3000 (`DEMO_PORT` overrides it). Quick tunnels are
public: share only the intended judging URLs. Controller, operator and tool
secrets stay private. The printed **public** origin is the one configured for
passkeys and policy/audit authentication; use that origin consistently.

The printed URLs include `/attack` for the judge's hostile-document proof.
The supervisor owns its private loopback server on port 8790 (`ATTACK_DEMO_PORT`
overrides it), checks that port before starting, and sets `ATTACK_DEMO_BASE_URL`
for the web proxy. It shares the private `TOOL_GATEWAY_SECRET` server-side only.
`demo:health` performs an authenticated GET and prints **Attack demo: reachable
(mock)** without a response body. No model call is made. `ATTACK_DEMO_LIVE` is
unset by default; live analysis requires explicit opt-in. `demo:down` stops this
child with the other owned process groups. The default mock child uses isolated
memory state, so it never opens a writer on the web host's rotating database.
Explicit live opt-in retains the configured StateStore for the LLM OFF gate.
If its port is busy, choose a free
`ATTACK_DEMO_PORT`; never stop another worker's listener. Its private log is
`.demo/attack.log`.

For a fully offline, phone-free rehearsal:

```sh
STATE_STORE=memory DEMO_TUNNEL=0 DEMO_PORT=3300 pnpm demo:up
```

The state mode defaults to `STATE_STORE=spacetime`. The supervisor owns a loopback
SpacetimeDB instance on port 3115 (`DEMO_STATE_PORT` overrides it), a private CLI
config, and only databases named `backroom-demo-<time>-<random>`. It never attaches
to or deletes a shared database. Startup publishes the current module; the host
imports frozen `fixtures/company/northfield.json` with the exported
`SpacetimeTransport.seedCompany` API. Reset publishes a **new** owned database
because `seed_company` is idempotent import, not destructive reset. Old local DBs
remain in `.demo/state/` for inspection. No sponsor bank state is touched.

Seats and Next route chunks run in one process and share the installed
`SpacetimeStateStore`; LLM OFF, invoices, immutable policies, approval decisions,
payment receipts and audit chains run through actual reducers. Gateway call/outbox
storage and finance repositories remain explicitly in-memory, and the bank HTTP
transport is mock. Those separate adapters do not become durable by selecting a
StateStore. See `docs/spacetime-state.md` and `docs/llm-control.md`.

In `STATE_STORE=memory`, the same bootstrap imports AR/AP states through the
StateStore API without starting a DB. The scripted #1042 ALLOW advances to
`promised` through reducers in either mode. The four-installment request is a
separate pending escalation; the two-installment link comes from an independent
in-policy ALLOW, not a bypass of Dana's decision. Three seat workers remain
running with mock effects. No fixture consent is permission to call a real person.

Reset preserves controller enrollment in the running process, the tunnel URL and
server secrets. It replaces the installed StateStore, approvals, payment links, receipts and
mock deposits; reopen the new printed links. The approval request expires after
**60 seconds**: reset immediately before the pitch and decide early. Stop/start
loses process-local passkey enrollment and changes the quick-tunnel origin;
enroll again. Reset does **not** cancel a real call, clear a real opt-out, delete
`.env.voice/`, touch `.nessie-state/`, or undo sponsor bank transactions.

Private `.demo/` contains 0600 controls, per-process logs and `voice.env` with the
current `VOICE_PUBLIC_URL=<tunnel>/_cartesia`. Existing `.env.local` is never
rewritten. On failure, inspect `.demo/supervisor.log` then the named child log
locally; provider output can be private. Never paste raw logs. A dead supervisor's
lock deliberately fails closed: verify its processes have exited before manually
removing `.demo/owner.lock` and `.demo/process.json`. `demo:down` never trusts a
persisted PID or uses `pkill`; unreachable control is an error, not permission to
kill another session.

For the opt-in GX10-only inference + Nessie sandbox rehearsal over the owned
SpacetimeDB server, run `pnpm demo:live --confirm-sandbox` after startup. It uses
scripted call turns and a software test passkey, never dials, and writes full
audit receipts. See [live receipt scope and reproduction](evidence/live-run/README.md).

## Maincloud state (opt-in; local fallback retained)

The full module is published at <https://spacetimedb.com/backrooms-calhacks13>.
The [Maincloud office parity](evidence/maincloud-parity/README.md) passes with
20/20 network-inclusive request-to-frame samples below 1s (max 208 ms).
Reproduce with `DEMO_SPACETIME=maincloud pnpm demo:parity` after a production
web build and CLI browser login. `pnpm demo:parity` remains the local lane.
Server processes use `STATE_STORE=spacetime`,
`SPACETIMEDB_URI=wss://maincloud.spacetimedb.com`, and
`SPACETIMEDB_DATABASE=backrooms-calhacks13`, plus the publisher's private
`SPACETIMEDB_TOKEN`. Keep that token in ignored private configuration with mode
0600 and transfer it privately. Browser subscribers receive only URI/database.

Maincloud makes the office subscription reachable from the public HTTPS origin;
confirm **State connected** on the actual judging device. It introduces network
latency and an internet dependency. Describe the deployment as “web and
orchestration on GX10; state hosted on SpacetimeDB Maincloud” when that is the
actual topology. Do not claim all stack components run on GX10 in this mode.

The owned demo host now supports fresh Maincloud databases too. Authenticate a
SpacetimeDB CLI 2.13.0 config privately first (the same publisher config used by
`demo:parity`). Then select the hosted lane at **startup**:

```sh
DEMO_SPACETIME=maincloud DEMO_MAINCLOUD=1 \
  SPACETIME_CONFIG=/absolute/private/cli.toml pnpm demo:up
pnpm demo:reset
pnpm demo:preflight
```

`BACKROOM_DEMO=1` is set by the owned supervisor. Hosted mode additionally
requires `DEMO_MAINCLOUD=1`, a private authenticated `SPACETIME_CONFIG`, and the
fixed Maincloud endpoint. An existing `SPACETIMEDB_DATABASE` value must be named
`backroom-demo-*` or startup refuses it; remove the legacy shared database
selection from the private environment before starting this fresh-database lane.
It never resets `backrooms-calhacks13` or any other existing shared DB. The
separate `DEMO_STATE_REMOTE=1` host mode still attaches to existing shared state
and refuses reset; do not combine it with `DEMO_SPACETIME=maincloud`.

Each reset publishes a new `backroom-demo-<time>-<random>` module, then the
existing private reset API stops the old seat workers, imports the seed company
via `seed_company`, installs the new StateStore and recreates the scripted
approval/pay scenario through public gateway/reducer APIs. No reducer changes,
SQL deletes, clear-database flags, or fixture edits are involved. Old local and
hosted databases remain for inspection; this is a clean **active run**, not data
erasure. The runtime integration seam remains `/__demo/reset` with
`{uri,database,token}`; autonomous runtime hosts must call their existing
`AgentCaseStore.stopCase(caseId, 'cancelled', 'DEMO_RESET')` and drain active
queries before switching the installed store. See [agents.md](agents.md).
This command does not stop independent agent runtime processes or clear separate voice/usage journals. Preserve the
real `FileUsageLedger` at `.env.agents/usage-ledger.json`: resetting the demo must
never reset credential-owner spend accounting or its budget limits.

Keep the same backend for the lifetime of a host; changing shell variables on
`demo:reset` does not retarget an already running host. To return to local,
`pnpm demo:down`, then `DEMO_SPACETIME=local DEMO_MAINCLOUD=0 pnpm demo:up`.
Reload the office and verify **State connected**. Maincloud publishing is opt-in
network activity; preflight itself is read-only and makes no model calls.

## Phone / operator setup

- Demo operator: big screen; use the printed **local** `/office` URL on the laptop
  for its anonymous SpacetimeDB subscription, and public `/audit`, `/policy` and
  `/inbox` as needed. Reload the office after reset so it subscribes to the new DB.
  The DB WebSocket remains loopback-only: a phone/public-origin office on another
  device is not connected through the web tunnel. Dana and pay pages use HTTPS
  HTTP APIs and do not need that WebSocket. Memory mode remains a labeled preview.
  Confirm the office connection indicator before judging.
- Dana: open public `/controller` on the passkey phone. Use the private
  `CONTROLLER_ENROLLMENT_SECRET` from `.env.local` or generated `.demo/private.env`;
  never display it. Complete registration before resetting for the pitch.
- Audit operator: unlock `/audit` with the private `CONTROLLER_ENROLLMENT_SECRET` from the
  same source. Policy operator: use the separate `POLICY_DEMO_PIN`.
- Network operator: hotspot/wired internet, charged backup phone, audible volume,
  both laptop and phone on the exact public HTTPS origin. Localhost belongs to
  the laptop; a phone cannot use it. Check the Sunday `DEMO_OVERRIDE` indicator
  and the logged permit on any real call; never infer consent from the fixture.

Voice is opt-in because the managed relay has its own persisted voice journal
and a live dial still needs fresh authorization. With the private voice secrets
configured per `orchestrator/src/voice/README.md`:

```sh
DEMO_VOICE=1 pnpm demo:up
```

This provisions/updates the agent webhook configuration with the new tunnel URL,
starts the relay on `VOICE_PORT` (8788), and forwards `/_cartesia/*` to it. It
places **no call**. Do not start another relay writer on `.env.voice/`. A real
phone take requires the README's consent/target/number setup and fresh explicit
`VOICE_DIAL_GO=yes` authorization. The voice receiver registers the synthetic call
in the web host and forwards authenticated tools to its GatewayStore. The
phone → Dana → pay loop is wired: approvals, payment links/QR, pay pages and
reconciliation use the web host's shared gateway and installed StateStore.
See [payment delivery](payment-delivery.md) for the verified headless QR/pay
receipt and the process-local link lifetime. A live phone end-to-end receipt is
still pending A0; the echo T1 test is not that receipt. Browser voice's current
smoke command is documented in `docs/t1-cartesia.md`.

## Three-minute sequence (truthful current checkout)

Assign people before the take: **presenter**, **Dana**, **demo operator**,
**network/backup operator**. Any teammate may fill each role; do not assume whose
phone holds the passkey. Run `demo:reset` immediately before the opening.

| Time | Speaker / operator | Action and claim |
| --- | --- | --- |
| 0:00–0:20 | Presenter; demo operator | Show the rehearsal banner and the office connection indicator. “Three finance seats, one human controller. This take uses synthetic company data and mock bank transport.” Open the new approval URL on Dana's enrolled phone. |
| 0:20–0:45 | Presenter; Dana | “Four payments exceed the code's badge.” Dana presses Deny and completes a real passkey assertion before the 60-second request expires. Show the resulting human audit entry. Do not describe the seeded identity as a live verification. |
| 0:45–1:15 | Demo operator; presenter | Open the printed pay URL, press Pay with simulated card, then show `partially_paid` and the exact-match reconciliation audit. “The real policy, SDK and reducer path ran over an in-memory mock HTTP transport.” No card data and no real money. |
| 1:15–1:45 | Demo operator; presenter | Invite a judge email/invoice in `/inbox`, submit it, and follow its exact audit link. Open the printed `/attack` URL for the hostile-document proof (mock by default; assessment only, no payment). Use the frozen #4419 or #4471 preset for the inbox trap proof. With OFF, unrecognized raw text escalates deterministically; arbitrary extraction and live vendor checks are not promised. |
| 1:45–2:15 | Presenter; audit operator | On `/audit`, select a cited event and ask why. LLM defaults OFF, so this is a cited deterministic answer. Show saved policy text and code/human attribution. Do not claim cloud narration was exercised. |
| 2:15–2:45 | Network operator; presenter | Show `pnpm demo:health` and `/real-vs-sim`. Separate configured key, reachable API, routed model call, and actual call/deposit receipts. Red means unavailable or unverified; say it plainly. |
| 2:45–3:00 | Presenter | “The renderer is a view. Code owns the money and the record; a passkey owns approvals.” State that the phone → Dana → pay loop is wired and the live phone receipt is still pending A0; invite policy Q&A. Report only actual eval receipt numbers. |

The target §6.2 sequence is live consent/company intake → judge call → Dana
passkey → pay/reconcile → judge inbox → cited why. Run that pitch only after all
those paths are connected and rehearsed. The operations script alone does not
satisfy that acceptance gate. Never present a recording, mock or preview as live.

## Backup order and three dress rehearsals

Run three complete takes, reset between them, then keep the winning take's state:
(1) ordinary run; (2) call-failure drill; (3) GX10-failure drill. Record the exact
failure, chosen fallback and what was actually demonstrated. Per §8.2 the target
is Sun 5–6:30 AM PT; recorded moment backups should exist on two laptops and a
phone by Sun 3 AM. This document does not claim those rehearsals happened.

1. **Call fails:** spec order is retry once (respect 1 dial/s), team phone,
   browser voice using the same managed agent/tools, text simulator, then a
   recording/webhook replay visibly labeled `REPLAY of call <id> at <time>`.
   An ambiguous dial is **not** automatically retried: the current voice adapter
   requires checking whether it connected first. Current browser WebSocket smoke
   is not yet proof of an integrated tool session. If unavailable, say so and
   proceed to labeled `STATE_STORE=memory pnpm demo:core` / recording; do not improvise a live call.
   Main now bundles `/office?replay=core-offline` and `/audit?replay=core-offline`
   with a persistent REPLAY label, play/pause and phase controls. This recording
   contains synthetic state/audit, **no call audio**; pair an actual recorded clip
   with it for the last voice fallback. See `docs/replay-mode.md`.
2. **GX10 down:** use exported router `route()`'s cloud fallback only after a
   successful cloud probe/live smoke. Last known OpenRouter response in this
   task was HTTP 402. A green GX10 `/models` read is not model-quality or fallback
   proof. Keep OFF for deterministic demo paths when cloud is unavailable; do
   not label OFF as “cloud fallback.” Use the existing real-vs-sim router banner
   where actual router observations exist; no shared GX10 process is stopped.
3. **3D breaks:** office controls offer fixed/tween camera then **2D plan**;
   finally show `/audit` alone. Memory mode remains a labeled preview; backend policy
   and the shared audit work without the renderer. Close the 3D tab during the terminal
   proof to demonstrate that rendering grants no authority.
4. **CRS / Apify / Nessie down:** try live first only in the owning opt-in smoke;
   cached evidence needs an actual `cached at hh:mm` timestamp. This host's mock
   bank is labeled mock and never counts as a Nessie T4 pass or cached live result.

## Optional judge moment: GX10 month burst (#29)

Keep this separate from `demo:up` and the three-minute core take. The single
command generates **925 synthetic AP inbox items** (37 per company × 25 companies),
then runs the real `processInbox` → schema validation → Payables/Vendor seats →
code policy/leased controller escalations path with bounded concurrent company
workers. No cloud call, Nessie HTTP write, external vendor check, or dial is
available. Approved payments have explicitly **simulated** receipts. State is
isolated in memory per company; it is not the office's shared database.

```sh
pnpm demo:burst -- --companies 25 --month 2026-09
```

The command runs `gx10 gpu` before inference and prints the shared GPU state;
it fails closed if that preflight fails. Default concurrency is **2**, capped at
8. Coordinate an idle window with teammates before a full burst; never unload
someone else's model. Use `--model qwen3:8b` for a smaller model or opt in to
`--model gpt-oss:120b` for quality over speed. The fixed transport allowlist accepts
only the GX10's exact Ollama completion endpoint and rejects redirects and cloud
fallback before network I/O, even when cloud keys are present in the shell.
The normal router's interactive 5-second circuit breaker is isolated per task
for this batch; each request has a 120-second timeout. This does not change the
application router or its global OFF switch. This standalone process owns an
isolated ON store; stop this command with Ctrl-C to stop its work.

Rehearse a small sample first:

```sh
pnpm demo:burst -- --companies 1 --month 2026-09 --items-per-company 1 --concurrency 1
pnpm demo:burst -- --companies 25 --month 2026-09 --plan
```

The second command only generates the workload and plan receipt. Generation is
reproducible code, with Northfield September invoice patterns, historical paid
invoices as duplicate evidence, unchanged approved Acme master for the duplicate
cohort, pending legitimate Cedar bank changes, and four frozen inbox red-team
traps per company. Company/date envelopes are generated for the requested month;
underlying line-item descriptions and IDs retain their fixture provenance. This
is a cloned synthetic stress workload, not 25 independently sampled businesses,
and does not claim PDF OCR or transcript processing.

Live JSON progress prints every second and after each completed item: cumulative
items/s, returned token counts and tokens/s, holds by rule, generic traps held,
expected-rule trap matches, false holds, model failures, simulated payments and
successful-task local share. A failed model call followed by a code safety hold
is counted as **both failure and hold**. Missing provider usage makes token rate
and cost comparison `null`; it never becomes zero. Model retries count toward
usage. Local share describes completed model tasks; failed task counts remain
visible. With no completed model tasks it is `null`.

Receipts are written under `.demo/burst/<run-id>/`: `manifest.json` includes the
source SHA and exact generated input, `events.jsonl` includes the manifest hash,
GPU preflight, item results, router failure categories, real seat audit entries
and progress, and `summary.json` contains the final aggregate. Existing audit
wall/metrics adapters can consume these files; **this command does not mount a
new UI or publish these rows to SpacetimeDB**. Exit status is nonzero for model
failures, missed holds, or missing expected trap rules. A killed take retains its
partial JSONL but has no complete summary; never label it complete.

Cloud-equivalent dollars are an **operator-priced estimate**, never a measured
cloud bill or benchmark. Supply both `--input-usd-per-million N` and
`--output-usd-per-million N` for your chosen comparison; without both, the value
is `null`. The receipt records the supplied rates. Actual cloud spend is zero
because cloud transport is forbidden.

Measured judge rehearsal (2026-10-24, `gpt-oss:20b`, concurrency **2**):

```sh
pnpm demo:burst -- --companies 10 --month 2026-09 --concurrency 2
```

The GX10 was already at **93% utilization** at the initial preflight, so this
budgeted take used **10 companies / 370 items**, rather than the 25-company
925-item default. See the [measured receipt](evidence/burst/ten-company/summary.json)
and [all 370 item/audit records](evidence/burst/ten-company/items.jsonl).

| Measured result | Value |
| --- | --- |
| Processing wall time | **18m 42.73s** (1,122.733676 s; excludes generation/GPU preflight) |
| Throughput | **0.329553 items/s** |
| Returned input + output tokens | **410,970 + 59,183** |
| Input + output token throughput | **418.757369 tokens/s** |
| Generated output throughput | **52.713303 tokens/s** |
| Planted traps held | **120 / 120** |
| Expected policy-rule matches | **79 / 80** |
| Failed model tasks / affected items | **5 / 5** |
| Completed local model tasks | **692 / 692 (100%)**; 697 tasks total, 698 local HTTP attempts |
| Raw `falseHolds` label counter | **30 / 250** non-trap-labeled items; caveat below |
| Simulated payments | **220**; no Nessie HTTP writes |
| Usage omissions / pending HTTP attempts | **0 / 0** |
| Cloud-equivalent dollars | **null** (comparison prices not supplied) |
| Command exit status | **1**, correctly reporting failures and one expected-rule miss |

Holds by rule (an item can cite multiple rules): `BANK_CHANGE_HOLD=30`,
`OFAC_STOP=20`, `INVALID_INPUT=44`, `PAYEE_NOT_IN_MASTER=17`,
`DUPLICATE_INVOICE=9`, `LOOKALIKE_DOMAIN=10`, `NO_PO=10`, `OVER_LIMIT=20`.

This is a completed measured take, **not a clean model-quality pass**. Four
model tasks failed confidence checks; one extraction failed schema validation.
The attempted cloud fallback was rejected by the transport guard **before HTTP**.
The duplicate trap `synthetic-0007:2026-09:4419` remained safely held under
`INVALID_INPUT`, but missed its expected `DUPLICATE_INVOICE` citation. This is why
120/120 safety holds must not be presented as 80/80 correct rule detection.

The raw false-hold label counter is conservative and **not a calibrated error
rate**: it counts the 30 ordinary-labeled invoices for Cedar's already-pending
bank change (`5002` × 10), the sanctioned vendor (`5023` × 10), and the unverified
vendor (`5024` × 10). These are code-required holds from trusted seed state;
three unverified-vendor items used `INVALID_INPUT` instead of the master rule.
All 220 other ordinary-labeled items reached a simulated payment. The committed
receipt retains the original labels/counts and every result, rather than
relabeling the take after seeing it.

Use this **18m 42.73s measured take** as the wall-time reference for the documented
10-company command; shared load varies. The 25-company default and a laptop
comparison remain unmeasured. Show the labeled receipt and a small live sample
during judging; do not claim a measured laptop speedup.

The [one-item live smoke receipt](evidence/burst/smoke.json) measured 3.24 seconds,
2 completed local tasks, 1,199 prompt + 164 output tokens, zero model failures,
and one simulated payment on `gpt-oss:20b`. It is a connectivity/path smoke, not
a 925-item throughput result. The runner's `tokensPerSecond` includes input plus
output; `outputTokensPerSecond` isolates generated output.

## GX10 production host and warm Mac fallback (Refs #29 #32)

`pnpm demo:up:gx10` bootstraps private Linux ARM64 tools, clones/fetches clean
`main` into `~/work/backroom-judge-host/app`, installs the lockfile, runs
`pnpm -r build`, then starts the existing detached demo supervisor. SSH logout
leaves it running. No sudo, system services, shared jobs or Ollama changes.
`GX10_HOST` selects the SSH alias; `GX10_DEPLOY_DIR=work/<name>` selects a different
owned directory. `GX10_REF` is for explicitly testing a candidate branch; the
judging default is `main`. A running host is reused without updating its checkout;
stop it before deploying a new release. Dirty tracked files fail closed.

```sh
pnpm demo:up:gx10
pnpm demo:health:gx10 --live
pnpm demo:down:gx10
```

The wrapper reads Mac Keychain item `backroom-anthropic-key` and transfers it over
SSH stdin to private `~/work/backroom-judge-host/anthropic.env` (0600). The key is
never printed, passed in command arguments, added to the shared team env, or
copied into the app's `.env.local`. Sponsor settings come from the GX10 team env.
Keep `host.env` and `state.env` under that same private host directory, mode 0600;
they are dotenv data, never sourced shell scripts. Inspect private host logs on
the GX10 (`build.log`, `install.log`, `app/.demo/*.log`); do not paste raw logs.

`host.env` defaults to the real sandbox adapter path and receiver (no dial), and may override these settings:

```dotenv
DEMO_LIVE=1
DEMO_VOICE=1
```

Voice setup creates/updates this checkout's private Cartesia agent/tools, then
starts the receiver. It never invokes `dial`. Receiver and control listeners
remain loopback-only. Its file-backed gateway is still separate from the web
StateStore; hosting does not prove phone → passkey → payment integration.

Actual callbacks `/api/voice/tools/*` and `/api/voice/cartesia` also proxy to the
authenticated receiver; `/_cartesia/*` remains available for relay health.

Web binds **100.117.44.20:3340** and **127.0.0.1:3340** with the same
handler/authentication. The loopback socket is required by the private voice
bridge; both listeners close together. Local fallback DB binds **100.117.44.20:3341**,
voice **127.0.0.1:3342**. Startup prints `ss -ltn`; the runner checks each selected
port before launch. The quick tunnel forwards HTTPS pages and `/_cartesia/*` to
web. From the Mac, use the printed Tailscale `/office` URL when the DB is local:
a public HTTPS office cannot subscribe to an insecure private `ws://` DB. Phone
approval/pay pages use the HTTPS tunnel and server APIs. Maincloud uses WSS and
makes the public office subscription accessible too.

If the Maincloud worker has published a **fresh database for this host**, place
its private settings in `~/work/backroom-judge-host/state.env`:

```dotenv
DEMO_STATE_REMOTE=1
STATE_STORE=spacetime
SPACETIMEDB_URI=wss://maincloud.spacetimedb.com
SPACETIMEDB_DATABASE=<fresh host database>
SPACETIMEDB_TOKEN=<private publisher token>
```

The host never publishes/deletes/resets external databases. `demo:reset` returns
409 in this mode. Seed is idempotent, so restarting against an already advanced
scripted database is not a clean rehearsal; obtain a fresh one from the state
operator. Without `state.env`, the host owns its own GX10 SpacetimeDB server and
fresh `backroom-demo-*` database. Never point two hosts at the same demo database.

The honest pitch is “the application server stack and routine inference run on
GX10; durable state is Maincloud when configured; Cartesia, Anthropic, Nessie and
Apify remain external services.” Do not say every provider runs on GX10.

### Switch in under one minute

Prepare the Mac **before** judging: install dependencies and SpacetimeDB 2.13.0,
copy sponsor env privately as in AGENTS.md, build once with `pnpm -r build`, then
keep a separate warm standby running:

```sh
DEMO_LIVE=1 DEMO_VOICE=1 DEMO_VOICE_SETUP=0 DEMO_PREBUILT=1 \
DEMO_PORT=3350 DEMO_STATE_PORT=3351 VOICE_PORT=3352 pnpm demo:up
```

Copy the already-provisioned voice resource IDs/secrets as described below before
starting this receiver. These flags use a separate local database, live sandbox
adapters, LLM ON and an existing-agent receiver; callbacks stay on GX10 until the
explicit setup command below. Save both hosts' public URLs and enroll Dana's
passkey on each origin in advance. Startup can make one capped Apify attempt.
For a labeled offline standby instead, select `DEMO_LIVE=0 DEMO_VOICE=0`; this
uses mock bank + LLM OFF. Never let two receiver writers use the same `.env.voice`
directory.

1. If GX10 degrades, open the already-warm Mac `/office` and the saved Mac public
   approval/pay pages. Keep the visible service/mode labels. No rebuild, SSH,
   credential copy or passkey registration belongs in this minute.
2. For fresh seeded links, run `pnpm demo:reset` on the **local** standby, then
   reopen its printed links (the approval expires after 60 seconds).
3. When GX10 health recovers, switch back to its saved URLs after a read-only
   health check. Do not stop/restart either origin during a live take.

This is a URL/origin switch, not transparent failover. Process-local finance and
voice state do not migrate. Complete an in-flight approval/payment on its original
host; never replay a possibly completed bank operation on the fallback.

For an equivalent warm live Mac receiver without allocating a second Cartesia
agent, copy **only** the GX10's private `.env.voice/resources.json` and
`.demo/voice-private.env` into those same paths in the separate Mac checkout
(mode 0600). Do not copy journals, gateway state or bank idempotency claims.
Start with `DEMO_LIVE=1 DEMO_VOICE=1 DEMO_VOICE_SETUP=0` plus the Mac ports above.
This does not update the active GX10 agent's webhook destinations. A fresh
second-agent attempt returned HTTP 402 during testing; do not keep retrying it
or purchase credits as part of switching hosts.

To direct **new sessions** to the prepared Mac receiver, update the existing
agent's tools/webhook explicitly from the Mac repo root:

```sh
STATE_STORE=memory node --env-file=.env.local --env-file=.demo/private.env \
  --env-file=.demo/voice-private.env --env-file=.demo/voice.env \
  --import ./orchestrator/node_modules/tsx/dist/loader.mjs \
  orchestrator/src/voice/live.ts setup
```

Measured existing-resource callback update: 6.3 seconds to Mac, 11.6 seconds to
restore GX10 (see the receipt). That updates existing IDs, never dials and must
finish before the receiver is
called active. Copy the current `.demo/voice.env` into the Node command only as
shown; it contains the warm Mac's public origin. Return traffic to GX10 by
running the same setup under the GX10 private env/current voice.env. Do not
switch a live call between separate journals. Hardware failure still needs
Cartesia/internet access to update callbacks; if those are down, say so and
continue with the web/text fallback.

Measured host latency and scope live in [the GX10 hosting receipt](evidence/gx10-host/README.md).
The reproducible opt-in `tools/demo/measure-hosts.ts` writes synthetic duplicate
inbox/audit rows only; it requires `MAC_PUBLIC_URL` / `GX10_PUBLIC_URL` for the
same-origin decision endpoints. Page loads use direct host URLs. It performs
no model inference, bank request, approval or dial.

After a host/listener change, exercise the authenticated bridge as well as health.
Run from the Mac repo root; the probe streams to the existing clean checkout
without replacing runtime sources:

```sh
ssh gx10 'cd ~/work/backroom-judge-host/app; PATH="$HOME/work/backroom-judge-host/.runtime/bin:$PATH" BACKROOM_ROOT="$PWD" node --import ./orchestrator/node_modules/tsx/dist/loader.mjs --input-type=module - --confirm-owned-demo' < tools/demo/voice-bridge-live.ts
```

This calls the private loopback client-stop read and an authenticated
`get_invoice_context` for seeded synthetic invoice 1042 (200 `CONTEXT`), plus the signed
public voice-tool callback for an unknown session (404 `SESSION_NOT_FOUND`). It
records one synthetic gateway delivery receipt but never registers a call, dials,
approves, pays, mutates a live call, or contacts a provider. A relay `/health` or
unsigned 401 alone does not prove bridge → web connectivity.
