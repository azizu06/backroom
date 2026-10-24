# Test v1 yourself

**Ready now:** a phone-free app rehearsal with real local SpacetimeDB, policy,
passkey verification, inbox, audit/why, policy editing and office views. The web
pay page uses mock bank HTTP; a separate live script exercises GX10 + Nessie.
Claude also has a separate live smoke. The full phone → Dana → bank demo is pending. Refs #29 #32.

From the repository root, with Node 22+, pnpm, cloudflared and SpacetimeDB CLI
**2.13.0** installed ([setup](demo-runbook.md)):

```sh
pnpm install
ssh gx10 cat /srv/team/backroom.env > .env.local
chmod 600 .env.local
pnpm demo:up
pnpm demo:health --live
```

Startup prints fresh URLs and places no call. Use the printed **public HTTPS
origin** for controller, approval, pay, inbox, audit and policy. Use the printed
**local office** URL for the loopback DB subscription. Keep the REHEARSAL banner.
For laptop-only use, `DEMO_TUNNEL=0 DEMO_PORT=3300 pnpm demo:up` avoids tunnel
availability. Private codes are in `.demo/private.env` unless overridden in `.env.local`:
controller **and audit** use `CONTROLLER_ENROLLMENT_SECRET`; policy uses
`POLICY_DEMO_PIN`. Never share the files or show their values in screenshots.

1. Open `/controller`, enter the controller code and create Dana's passkey.
   Then run `pnpm demo:reset`, and open its **new approval URL immediately**.
   Four payments should cite `MAX_INSTALLMENTS`. Press **Deny with passkey**
   within 60 seconds; expect “Your decision is recorded.” This starts from a
   synthetic, preverified caller, and the two-payment link is a separate ALLOW.
2. Open the new pay URL. Press **Pay $2,475.00 with simulated card**; expect
   “Payment matched. Invoice partially paid.” Reload: deposit stays recorded.
   This browser take exercises real code/reducers over **mock Nessie HTTP**.
3. Open `/inbox`. Route presets **4419** and **4471**. Both must be held/
   `ESCALATE`; 4471 cites `LOOKALIKE_DOMAIN, BANK_CHANGE_HOLD`. Follow its audit
   link, unlock with the **controller code**, and expect that exact replay plus
   **Chain verified**. Write your own email too: unknown text with OFF goes to
   human review; attachments are fingerprinted, not parsed.
4. On `/audit`, ask “Why was invoice 1042 escalated?” Expect cited **Recorded
   facts · code fallback**. LLM defaults OFF; decisions, passkeys, holds and
   payments still work. `/real-vs-sim` reports this web process only; “Not probed”
   does not become green because a separate live script succeeded.
5. On `/policy`, unlock with the policy PIN, change maximum installments **2 → 3**
   and save v2. New decisions use v2; old audit/approval evidence retains v1.
   Lock the editor afterward. Reset returns the rehearsal to its starting policy.
6. Open the local `/office`: expect **State connected**, three seat badges,
   Dana and locked Treasury. Use room buttons for a manual tour; try **Fixed
   camera**, then **Floor plan**. Both use the same subscribed state.

Optional live checks (no phone; keep Nessie claims between runs):

```sh
gx10 gpu
pnpm demo:live --confirm-sandbox
PRECALL_APIFY=live pnpm --filter @backroom/orchestrator apify:live
pnpm demo:down
```

`demo:live` uses fresh owned DBs, scripted call turns and a software test passkey;
it checks all three moments with actual GX10 inference and Nessie sandbox
read/deposit/reconciliation. It does **not** change the web host's mock bank.
For the separately verified Claude smoke, use the private-key setup and bounded
command in [the Anthropic guide](evidence/anthropic/README.md).
Apify starts one website-only Actor run, capped at $0.10 with no retries; do not
repeat an ambiguous start. Always finish with `pnpm demo:down`.

**Verified October 24:** [receipts/screenshots](evidence/test-v1/README.md).
Remaining gaps: phone round-trip awaits Aziz's dial go;
team env has no CRS credentials (the client has separate sandbox evidence, but
business-credit/OFAC and core wiring remain absent). Automated Tour is pending
Diego's branch. The parity smoke currently fails at the lobby's audit unlock;
reported to Diego. Real human phone biometrics, voice disclosure/tool round-trip,
and the full live phone/shared-state/bank loop remain unproven.
