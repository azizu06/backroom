# Live web walkthrough — October 24, 2026

[Browser receipt](2026-10-24T13-28-49.823Z/receipt.json) and screenshots:
[pay/reconciliation](2026-10-24T13-28-49.823Z/04-pay.png),
[cited model why](2026-10-24T13-28-49.823Z/07-ask-why-live.png),
[office](2026-10-24T13-28-49.823Z/10-office-orbit.png).
[Same-host health](health.txt) intentionally distinguishes listing/configuration
checks from successful inference; the browser receipt proves the latter.

The judge-facing production web host ran with `DEMO_LIVE=1`, real owned local
SpacetimeDB 2.13.0, actual Nessie sandbox transport, a completed website-only
Apify Actor run and a cited Anthropic ask-why answer. No phone dial. The caller,
company, card and Chromium WebAuthn authenticator remain synthetic.

The Nessie client uses persistent file claims and invoice/installment memos.
The host can recover an existing deposit: this take proves read/feed/exact
reconciliation, not a fresh balance increase. The screenshot retains the honest
account balance + Nessie-reported posted deposits formula, not settlement.

CRS credentials are absent in this worktree; the host uses its labeled FAKE
fixture client. The sandbox exposes public records/fraud risk, not business
credit/OFAC. Existing credentialed client evidence lives in
[the CRS receipt](../../crs/live-run.json).

Service health comes from authenticated `/__demo/health` in the web process.
It distinguishes mock/unused services, listing-only GX10 probes, configured-only
Anthropic, actual Apify completion and FAKE CRS. `/real-vs-sim` is Diego-owned
and has not yet consumed the exported safe host observation.

Run against a freshly started, unenrolled owned live host:

```sh
DEMO_LIVE=1 DEMO_TUNNEL=0 DEMO_PORT=3310 DEMO_STATE_PORT=3125 pnpm demo:up
pnpm demo:health --live
node tools/demo/rehearse.mjs --live
pnpm demo:down
```

The script reads private controls without printing them. Screenshots are captured
with cleared enrollment/unlock forms; no credentials or request tokens are saved.

Final take: GX10 `gpt-oss:20b` classification **1.726 s** and field extraction
**5.003 s**, both `route=local`, zero cloud cost for those two calls. An earlier
free-form probe legitimately used Anthropic `cloud_fallback` for extraction
(estimated **$0.003124**). Both complete walkthroughs returned model-sourced
ask-why answers with validated citations. This worker started **two** capped
Apify runs total, one per owned host; company resets reused each host's run.
No third run or phone dial. Anthropic spend remains below the $2 task budget;
ask-why's HTTP response does not expose its exact token charge.

Validation: `pnpm -r test`, `pnpm -r typecheck`, production build through
`demo:up`, the focused gateway suite (26/26), and the complete headless live
walkthrough passed. Unit tests mock network traffic. All owned demo processes
were stopped; sponsor deposits and durable claims were retained.

The new host adapter records synthetic pre-call evidence in the same audit
store. After this browser take, #113 merged and the host now consumes its exported
`createPreCallCreditCheck()`/`runPreCall()` flow, using cached Apify results.
Credentialed live mode also enables the vendor fraud checks. A mocked integration
regression proves bankruptcy blocks before model planning; final workspace
build/typechecks and **651 tests** pass. The headless capture and health snapshot
precede that last factory hookup. No third Actor run was made for recapture.
Actual dial readiness and a credentialed CRS probe remain outside this take;
unknown OFAC is never represented as clear. Synthetic gateway rehearsal links
are separate from the pre-call permit.
