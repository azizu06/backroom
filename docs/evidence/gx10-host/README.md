# GX10 judge host receipt (Refs #29 #32)

Measured 2026-10-24 from the Mac. The application server stack is running on the
GX10, with a separate warm Mac standby. **Maincloud state is outside the GX10**;
Cartesia, Anthropic, Nessie and Apify remain external services.

```text
Mac browser → Tailscale / public HTTPS → GX10 web + seats + gateway + voice receiver
                                           → dedicated Maincloud database
Mac fallback → separate local SpacetimeDB + same live sandbox adapters/receiver
```

The initial clean GX10 deployment is recorded in [deployment.json](deployment.json).
The later loopback correction is deployed as recorded in
[deployment-loopback.json](deployment-loopback.json).
Production `pnpm -r build` passed on Linux ARM64. Node 24.22.1, pnpm 12.14.0,
cloudflared 2026.10.3 and SpacetimeDB CLI 2.13.0 are user-local. The detached
supervisor survives SSH logout; no system/Ollama/other-user changes were made.
The deployed revision is the PR candidate; `main` is the wrapper's release default
once merged. Stop the owned host before updating its checkout.

A **new** `backrooms-gx10-judge-1792851602` database was published using the full
current-main module. `spacetime/scripts/seed.ts` imported synthetic Northfield
(10 clients, 25 vendors, 10 AR and 83 AP invoices). The pre-existing shared
`backrooms-calhacks13` database was not reset or modified. The private publisher
token stays in 0600 files on trusted servers, absent from browser configuration
and this evidence. Anthropic is a separate private GX10 file, transferred over
SSH stdin from Keychain, absent from app/team env files.

## Health and fallback

[health.json](health.json) records headless production checks:

- Both offices subscribe to live state; the public GX10 office opens an actual
  `wss://maincloud.spacetimedb.com` connection. Mac uses its own loopback database.
- Controller, approval, pay, inbox and real-vs-sim pages return 200 with zero
  browser errors. This checks page availability, not a new human passkey/payment.
- Both receivers respond through the HTTPS tunnel. Unsigned Cartesia event/tool
  callbacks return **401 from the receiver**, rather than Next 404. Private
  supervisor web controls also return 401 without credentials.
- External-state supervisor reset was rejected with 409, with no republish/reset.
- The warm office/controller URL switch completed in **256 ms**.

Both `demo:health --live` commands passed web/seats, state, Cartesia key, Nessie
sandbox reads, configured GX10 model, actual Anthropic pre-call preparation,
capped Apify run, receiver and tunnel checks. CRS stays RED/FAKE; OFAC and business
credit remain unavailable. A receiver/key/URL check is not a live call receipt.
No phone was dialed, no approval was made, and no bank payment was submitted.

A second Cartesia agent allocation returned HTTP 402. The fallback therefore
reuses the already-provisioned agent/tool IDs and secrets; it starts a receiver
with `DEMO_VOICE_SETUP=0` and does not rewrite the active GX10 URLs. An explicit
existing-resource setup redirected callbacks to Mac in **6,295 ms** and restored
GX10 in **11,610 ms** ([voice-switch.json](voice-switch.json)). GX10 is active
again. No new agent was allocated in that check, and no call/journal migrated.
Passkeys must already be enrolled on both origins; in-flight approvals, calls and
payments must finish on their original host. See the [switch runbook](../../demo-runbook.md#switch-in-under-one-minute).

## Latency: hosted state is a real tradeoff

**GX10 + Maincloud is measurably slower than Mac + local state.** Keep the office
warm before the pitch. The Mac standby gives the fastest observed judging path;
choose it if low latency matters more than the GX10-hosted application claim.
The hosted path still worked throughout this sample, but is clearly worse for a
latency-sensitive live demo. Prefer the warm Mac for that take unless the GX10
hosting narrative is worth this visible delay.

| Metric | Mac + local DB median / p95 | GX10 + Maincloud median / p95 |
| --- | ---: | ---: |
| Office page load | 55 / 56 ms | 440 / 524 ms |
| Office state connected | 109 / 110 ms | 1,817 / 1,908 ms |
| Held duplicate decision | 81 / 225 ms | 944 / 1,897 ms |

[latency.json](latency.json) contains every sample: five fresh Chromium contexts
per office and ten deterministic duplicate decisions per host. Pages use direct
localhost/Tailscale URLs; decisions use each configured HTTPS tunnel because the
intake correctly rejects mismatched origins. Server routes were warmed first.
Decision timing includes HTTP, code policy, reducers and audit; it excludes model
inference, a bank request, physical display/GPU performance, and phone speech.
Small sequential samples are not a load test or a long-term network guarantee.

The earlier [local-state comparison](latency-local-state.json) recorded GX10 with
its own local DB at page/state/decision medians 161/309/76 ms versus Mac
72/142/78 ms. That comparison cautions against attributing all hosted-state delay
to GX10 compute. Neither result proves arbitrary model-driven inbox latency.

Reproduce on already-running owned hosts (writes synthetic inbox/audit rows only):

```sh
MAC_STATE_BACKEND=local GX10_STATE_BACKEND=maincloud \
MAC_PUBLIC_URL=<warm-Mac-HTTPS-origin> GX10_PUBLIC_URL=<GX10-HTTPS-origin> \
STATE_STORE=memory pnpm --filter @backroom/orchestrator exec tsx \
  ../tools/demo/measure-hosts.ts mac=http://127.0.0.1:3350 gx10=http://100.117.44.20:3340
```

Vitest: **775 tests passed** across policy, Nessie, orchestrator, SpacetimeDB and
web, including bind/external-state/callback boundary regressions. Full production
build passed. No additional review or no-mistakes pipeline is claimed.

One later fresh-database publish took several minutes. Publication and successful
seed were confirmed before the final hosted launch. The earlier owned judge DB
is retained too; no shared database was modified. These deployment delays make
the already-warm Mac especially important.

## Review correction: private voice bridge

The original Tailscale-only web listener refused the bridge's hard-coded
`127.0.0.1:3340` requests. This was reproduced as `ECONNREFUSED` on GX10; the
original relay-health and unsigned-401 checks did not cover this hop.

The same request handler/authentication now listens on Tailscale **and** IPv4
loopback, with both listeners closed on shutdown. The default Mac bind remains
one loopback listener. Startup checks both required addresses before launch.
The local HTTP integration regression calls the actual exported voice bridge
against a non-loopback listener, checks its private loopback admin/gateway calls,
and proves both sockets close. All 7 focused host/bridge/listener tests pass;
a fresh workspace production build passes.

The [authenticated GX10 probe](voice-bridge.json) confirms:

- Private client-stop read succeeds through loopback.
- Private admin access through the Tailscale socket is still rejected with 403.
- `bridge.gateway(get_invoice_context)` returns 200 `CONTEXT` for the seeded,
  already-preverified synthetic invoice 1042. Amounts/contact details are not
  printed. This records one synthetic delivery receipt, with no economic effect.
- Signed public voice-tool callback rejects an unknown session with 404
  `SESSION_NOT_FOUND`.

The probe streams from the Mac into the existing clean deployed checkout; it
never replaces live runtime source files. It makes no registration, dial,
provider request, approval/payment or live-call mutation. The Mac standby was
retained. The latency table above is the earlier snapshot, not a remeasurement
of this listener-only correction.

An additional unknown-call negative probe returned 500 `GATEWAY_ERROR` from the
web gateway instead of its source adapter's 404. That separate error-mapping
behavior is unchanged here; connectivity is verified using the successful
synthetic context read. This is still not proof of an actual phone call.
