# No-SMS call payment delivery

`demo:up` is the payment authority. The voice receiver registers its synthetic Northfield call in the web host, then forwards authenticated tool requests to that host's gateway. The gateway, short-code resolver, QR projection and pay page read the **same GatewayStore**. Gateway audits and reconciliation receipts use the installed StateStore (memory or SpacetimeDB). Gateway call/link rows remain process-local: restarting/resetting the demo invalidates old links. There is no voice-file fallback and no SMS provider.

## Run and placement

Start the normal public demo with `DEMO_VOICE=1 pnpm demo:up`; setup/serve do not dial. A new phone call still needs fresh explicit dial authorization. `DEMO_PUBLIC_URL` must be an HTTPS origin, without a path, credentials or query. `demo:up` passes it, the private control secret and port to voice automatically. Standalone `voice/live.ts serve` now requires that demo host configuration; the historical voice-local payment file is not a supported payment host.

After an ALLOWed `propose_plan`, `send_payment_link` returns `short_code`, `expires_at`, the opaque `link_path` and the plan-bound `amount_cents`. The voice bridge adds `payment_url` and speakable `speak` text. The agent reads the URL/code and offers the screen QR; it never claims an SMS was sent. Cloudflare quick-tunnel hostnames are long: scanning is the preferred judge handoff; the spoken code is ten characters, read individually.

Diego's placement contract: import the default `web/components/PaymentLinkPanel.tsx` and mount `<PaymentLinkPanel />` in the office/lobby or Play-mode interaction. No props, secrets or write authority. It polls `GET /api/pay/active` every two seconds, displays the most recently linked active call, and clears on failure/expiry. A standalone `/payment-link` display is available immediately. The endpoint deliberately exposes the displayed payment capability to viewers of this demo, so keep the host limited to consenting demo participants. QR generation is local; no third-party QR service sees the link.

`GET /p/<code>` resolves case-insensitively and redirects to the public `/pay/<opaque-id>` page. Both code resolution and payment authorization enforce the fifteen-minute expiry and original ALLOW terms/amount. A stale code cannot be refreshed merely by resending the same plan. Expired or tampered links cannot create deposits. Payment HTTP accepts no caller-selected amount. Reconciliation uses exact Nessie memo/amount/deposit evidence, never a model claim.

Private voice registration is `POST /__demo/voice-call` with exactly `{sessionId}` and the demo control bearer. The server constructs the invoice/contact/amount from its fixture, starts identity unconfirmed, and rejects stopped clients. The endpoint also requires loopback **and** the private loopback Host; the tunnel fails even with the bearer. No contact or destination is logged. Voice tools retain their separate tool gateway bearer.

## Verification

- `pnpm --filter @backroom/web test` — gateway/payment/session/expiry/amount tests (offline, network mocked).
- `pnpm --filter @backroom/orchestrator exec vitest run src/voice` — forwarding, disclosure/identity and lifecycle tests; includes `text:null` tool-only turns.
- `node tools/demo/rehearse.mjs --paylink` — an already-running owned **mock-bank** host; decodes rendered QR pixels, follows public short URL, pays and checks reconciliation/reload. `--live --paylink` explicitly selects an already-running real Nessie sandbox host. This extends the existing opt-in rehearsal script; no second Nessie live runner and no dial.

Observed 2026-10-24 13:49 UTC: public Cloudflare HTTPS, real Nessie sandbox HTTP, synthetic voice call registration, LLM OFF. Rendered QR decoded to the exact public code URL; identity gate held; unauthenticated registration returned 401 and tunnel registration 403. The pay page showed **247500 cents**, created a sandbox deposit, reconciled to `partially_paid`, and retained the receipt after reload. Evidence: `docs/evidence/test-v1/live/2026-10-24T13-49-23.770Z/paylink.json` and adjacent screenshots. This proves a headless QR/pay handoff, not delivery to a phone or a live Cartesia retest. Nessie is sandbox money; the combined balance display is not settlement.

The live walkthrough used the shared memory StateStore. A local Spacetime-mode launch could not run because this worktree has no Spacetime CLI (`DEMO_COMMAND_UNAVAILABLE`); that optional mode was not claimed as live-tested here. The gateway-to-StateStore/reconciliation path is unchanged across the two modes.

The final styled panel was also rechecked with the offline mock-bank host at 13:53 UTC; QR decode, payment and receipt reload passed again. Screenshots and report: `docs/evidence/test-v1/2026-10-24T13-53-09.833Z/`. Full workspace validation: `pnpm -r test` (675 tests) and `pnpm -r build` passed.
