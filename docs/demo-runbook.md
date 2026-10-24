# Local demo operations (Refs #2)

This is the rehearsal host for spec §6.2, §6.3 and the three §8.2 dress rehearsals.
It is **memory state + mock bank transport + synthetic, already verified caller**.
It does not turn the office preview, the local voice relay, or external sponsor
checks into one connected production system. Keep the rehearsal banner visible.

## Bring up / reset / shut down

Requires Node 22+, `pnpm install`, and `cloudflared` on PATH. Commands run from the
repo root. `.env.local` is loaded server-side; never copy its values into logs,
board posts, client props or screenshots. Retrieve the team env as documented in
AGENTS.md only if needed. No command here dials a phone.

```sh
pnpm demo:up           # production web build, shared-process seats, quick tunnel
pnpm demo:health       # local status + configured/missing; no external probes
pnpm demo:health --live # read-only, bounded GX10 /models, Nessie account, tunnel probes
pnpm demo:reset        # restore scripted memory state; reprint fresh approve/pay links
pnpm demo:down         # stop only this supervisor's child process groups
```

`demo:up` stays alive through a detached, worktree-owned supervisor; the command
returns all URLs after readiness. Repeating it reuses this instance. The default
web listener is loopback port 3000 (`DEMO_PORT` overrides it). Quick tunnels are
public: share only the intended judging URLs. Controller, operator and tool
secrets stay private. The printed **public** origin is the one configured for
passkeys and policy/audit authentication; use that origin consistently.

For a fully offline, phone-free rehearsal:

```sh
DEMO_TUNNEL=0 DEMO_PORT=3300 pnpm demo:up
```

The state mode defaults to `STATE_STORE=memory`. Seats and Next route chunks run
in **one process** using the exported `getStateStore` / `installStateStore` APIs,
so OFF and approvals share state. Frozen `fixtures/company/northfield.json` rows
seed AR/AP state; the scripted #1042 ALLOW advances to `promised` through the
reducers. The seeded four-installment request is a separate pending escalation;
the two-installment link comes from an independent in-policy ALLOW, not a bypass
of Dana's decision. Three seat workers remain running with mock effects. No
fixture consent is permission to call a real person.

`STATE_STORE=spacetime` currently refuses startup, before touching a database.
Main's SpacetimeDB module is only the T8 spike; #15 has not supplied the shared
StateStore/gateway/finance adapters or a company import/reset reducer. Do not
publish the spike and describe that as seeded application persistence. Once #15
lands, replace this flag's refusal with its exported connect/publish/import seam;
keep all consumers on the same store (see `docs/llm-control.md`).

Reset preserves controller enrollment in the running process, the tunnel URL and
server secrets. It replaces memory state, approvals, payment links, receipts and
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

## Phone / operator setup

- Demo operator: big screen; open the printed public `/office`, `/audit`, `/policy`
  and available `/inbox` in tabs. `/office` is still a labeled preview on current
  main; it is not subscribed to this host's live StateStore. Use `/audit` for
  authoritative backend evidence. Confirm every printed surface before judging.
- Dana: open public `/controller` on the passkey phone. Use the private
  `CONTROLLER_ENROLLMENT_SECRET` from `.env.local` or generated `.demo/private.env`;
  never display it. Complete registration before resetting for the pitch.
- Audit operator: unlock `/audit` with the private `TOOL_GATEWAY_SECRET` from the
  same source. Policy operator: use the separate `POLICY_DEMO_PIN`.
- Network operator: hotspot/wired internet, charged backup phone, audible volume,
  both laptop and phone on the exact public HTTPS origin. Localhost belongs to
  the laptop; a phone cannot use it. Check the Sunday `DEMO_OVERRIDE` indicator
  and the logged permit on any real call; never infer consent from the fixture.

Voice is opt-in because the managed relay has its own persisted gateway/journal
and a live dial still needs fresh authorization. With the private voice secrets
configured per `orchestrator/src/voice/README.md`:

```sh
DEMO_VOICE=1 pnpm demo:up
```

This provisions/updates the agent webhook configuration with the new tunnel URL,
starts the relay on `VOICE_PORT` (8788), and forwards `/_cartesia/*` to it. It
places **no call**. Do not start another relay writer on `.env.voice/`. A real
phone take requires the README's consent/target/number setup and fresh explicit
`VOICE_DIAL_GO=yes` authorization. The relay's current file store is separate
from Next's memory demo: its escalations and links are **not** wired into these
pages. Do not promise the full phone → Dana → bank loop until #15/integration
work and a real end-to-end receipt establish it. The echo T1 test is not that
receipt. Browser voice's current smoke command is documented in `docs/t1-cartesia.md`.

## Three-minute sequence (truthful current checkout)

Assign people before the take: **presenter**, **Dana**, **demo operator**,
**network/backup operator**. Any teammate may fill each role; do not assume whose
phone holds the passkey. Run `demo:reset` immediately before the opening.

| Time | Speaker / operator | Action and claim |
| --- | --- | --- |
| 0:00–0:20 | Presenter; demo operator | Show the rehearsal banner and office preview. “Three finance seats, one human controller. This take uses synthetic company data and mock bank transport.” Open the new approval URL on Dana's enrolled phone. |
| 0:20–0:45 | Presenter; Dana | “Four payments exceed the code's badge.” Dana presses Deny and completes a real passkey assertion before the 60-second request expires. Show the resulting human audit entry. Do not describe the seeded identity as a live verification. |
| 0:45–1:15 | Demo operator; presenter | Open the printed pay URL, press Pay with simulated card, then show `partially_paid` and the exact-match reconciliation audit. “The real policy, SDK and reducer path ran over an in-memory mock HTTP transport.” No card data and no real money. |
| 1:15–1:45 | Demo operator; presenter | If `/inbox` exists, invite a judge email/invoice, submit it, and follow its exact audit link. If absent on this checkout, say so; run `pnpm demo:core` as a separate, clearly labeled terminal proof of #4471 and #4419. Its store is separate from the browser wall. Never claim an unavailable tray was live. |
| 1:45–2:15 | Presenter; audit operator | On `/audit`, select a cited event and ask why. LLM defaults OFF, so this is a cited deterministic answer. Show saved policy text and code/human attribution. Do not claim cloud narration was exercised. |
| 2:15–2:45 | Network operator; presenter | Show `pnpm demo:health` and `/real-vs-sim`. Separate configured key, reachable API, routed model call, and actual call/deposit receipts. Red means unavailable or unverified; say it plainly. |
| 2:45–3:00 | Presenter | “The renderer is a view. Code owns the money and the record; a passkey owns approvals.” State remaining phone/shared-state integration gaps and invite policy Q&A. Report only actual eval receipt numbers. |

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
   proceed to labeled `pnpm demo:core` / recording; do not improvise a live call.
2. **GX10 down:** use exported router `route()`'s cloud fallback only after a
   successful cloud probe/live smoke. Last known OpenRouter response in this
   task was HTTP 402. A green GX10 `/models` read is not model-quality or fallback
   proof. Keep OFF for deterministic demo paths when cloud is unavailable; do
   not label OFF as “cloud fallback.” Use the existing real-vs-sim router banner
   where actual router observations exist; no shared GX10 process is stopped.
3. **3D breaks:** office controls offer fixed/tween camera then **2D plan**;
   finally show `/audit` alone. The preview is still a preview; backend policy
   and the shared audit work without it. Close the 3D tab during the terminal
   proof to demonstrate that rendering grants no authority.
4. **CRS / Apify / Nessie down:** try live first only in the owning opt-in smoke;
   cached evidence needs an actual `cached at hh:mm` timestamp. This host's mock
   bank is labeled mock and never counts as a Nessie T4 pass or cached live result.
