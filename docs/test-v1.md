# Test v1 yourself

**Ready now:** a phone-free app rehearsal with real local SpacetimeDB, policy,
passkey verification, inbox, audit/why, policy editing and office views. Default
mode uses mock bank HTTP and LLM OFF. Opt-in live mode runs the same web app
against GX10, Anthropic, Nessie sandbox and capped Apify pre-call checks. The full
phone → Dana → bank demo is pending. Refs #29 #32.

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

## Live web mode (no phone)

Stop the owned rehearsal before changing modes. Keep `.nessie-state/claims`
between starts; changing links, resetting the company or retrying payment reuses
`backroom:invoice=1042:installment=1`, never deliberately posts another installment.

```sh
pnpm demo:down
DEMO_LIVE=1 pnpm demo:up
pnpm demo:health --live
node tools/demo/rehearse.mjs --live
pnpm demo:down
```

For laptop-only verification, add `DEMO_TUNNEL=0 DEMO_PORT=3310
DEMO_STATE_PORT=3125` to the startup command. The live startup reads
`ANTHROPIC_API_KEY` from ignored `.env.local`; if absent on macOS it imports
Keychain service `backroom-anthropic-key` into that file without printing it.
Nessie requires `NESSIE_API_KEY`; `NESSIE_ACCOUNT_ID` is optional because startup
can find/seed the sandbox Northfield account with durable claims.

The live flag enables the web host's shared LLM switch (unless `DEMO_LLM=off`),
GX10 routine routing and Anthropic hard-call routing. Repeat steps 1–6 above:
the pay page now uses **real Nessie sandbox HTTP**, and ask-why should show
**Model explanation · verified citations**. The amount, passkey boundary, holds,
and honest account-balance-plus-posted-deposits label are unchanged. Sandbox
posted deposits are not settlement; the card and caller remain simulated.

Apify uses `PRECALL_APIFY=live`: one pinned website-only Actor attempt per owned
host, capped at **$0.10**, with no retry after an ambiguous start. Company resets
reuse that attempt; restarting the host can initiate a fresh attempt. Public
company input remains separate from CRS's synthetic identity. CRS uses
`createCrsClientFromEnv()` when both credentials exist, otherwise the explicitly
**FAKE** fixture client. Only public-record and fraud-risk products are available;
the event sandbox offers no business credit or OFAC. With credentials, startup
also enables `PRECALL_CRS=live` and `VENDOR_CRS=live`, consuming the exported
pre-call and bank-change checks. The scripted pre-call gate records blocked
results (including bankruptcy/unknown OFAC); the separate preverified gateway
rehearsal remains synthetic. No result grants live dial or payment authority.

`demo:health --live` asks the running web process for its actual adapter probes.
It never infers live Nessie usage from the CLI's keys. GX10 model listing is
read-only; cloud configuration alone is explicitly **not** an inference receipt.
`getDemoHostServices()` in `web/lib/demo/services.ts` exposes a safe server-only
observation for Diego's panel work. `/real-vs-sim` and `/api/demo-status` remain
owned by Diego; until his probe wiring lands they can still say “Not probed”
even when this walkthrough proves the web service worked.

The headless live walkthrough requires actual GX10 classification, local-first
routed field extraction and an Anthropic-backed cited answer; it also exercises the same passkey, bank,
inbox traps, policy v2 and office views as the default walkthrough. See the
[live evidence](evidence/test-v1/live/README.md). No phone is dialed.

Optional independent service checks (keep Nessie claims between runs):

```sh
gx10 gpu
pnpm demo:live --confirm-sandbox
PRECALL_APIFY=live pnpm --filter @backroom/orchestrator apify:live
pnpm demo:down
```

`demo:live` uses fresh owned DBs, scripted call turns and a software test passkey;
it checks all three moments with actual GX10 inference and Nessie sandbox
read/deposit/reconciliation. It does **not** change the web host's selected bank mode.
For the separately verified Claude smoke, use the private-key setup and bounded
command in [the Anthropic guide](evidence/anthropic/README.md).
Apify starts one website-only Actor run, capped at $0.10 with no retries; do not
repeat an ambiguous start. Always finish with `pnpm demo:down`.

**Verified October 24:** [receipts/screenshots](evidence/test-v1/README.md).
Remaining gaps: phone round-trip awaits Aziz's dial go;
team env has no CRS credentials for this host. Public-record/fraud-risk sandbox
evidence exists at `docs/evidence/crs/live-run.json`; a credentialed probe of the
new pre-call/vendor wiring is separate. Business credit and OFAC are unavailable
in the Cal Hacks sandbox (#4). Automated Tour is pending Diego's branch. The
parity lobby-unlock regression is fixed on main by #110. Real human phone
biometrics, voice disclosure/tool round-trip,
and the full live phone/shared-state/bank loop remain unproven.
