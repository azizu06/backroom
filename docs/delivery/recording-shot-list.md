# 2:55 demo recording shot list

**Planned recording, not a recording receipt.** Based on spec §6. Main recording window: **Sun Oct 25, 1–3 AM PT**, after the 1 AM code freeze. Maximum three main takes. Choose the final working subset at freeze; do not record an unsupported integration claim to fill a slot.

## Readiness before rolling

- [ ] A consenting teammate performs the client role; permission covers the call, recording and intended public video. Hide real numbers and contact details.
- [ ] Save the tested commit, seed revision, frozen answer-key hash, service modes, sanitized run/call IDs and start time in the recording log below.
- [ ] Capture the entire underlying call, including AI/business/recording opening, identity gate, callback close, tool events and approval. The edited opening can jump to the key moment without hiding a failure in the evidence record.
- [ ] Verify the controller passkey path on the actual phone; credentials/tokens never appear. Sunday hours override is visible and logged. Confirm stop flags and consent independently of the hours override.
- [ ] Show the real/sandbox/synthetic panel throughout. Enable clear phone audio, readable transcript, captions and legible audit IDs. Keep secrets and raw CRS data out of view.
- [ ] Run one rehearsal through the complete core loop with 3D closed. Check source timestamps and model routes. Confirm live Claude access; HTTP 402 is unresolved in reviewed evidence.
- [ ] Resolve the voice gate: T1 is setup only, with no live dial yet. Merged gateway/worker code (#36/#37) does not prove the opening call or same-call approval.
- [ ] Preserve the Nessie #42 diagnostics: live customer/checking/deposit/feed reads succeeded, but **T4 FAIL** because balance stayed 0; fractional dollars were truncated and are now client-rejected. Record this as a balance exception unless a new receipt proves recovery. A posted deposit alone cannot support reconciliation, a paid invoice or fabricated balance growth.
- [ ] Separate local SpacetimeDB T8 PASS (#43: reducer rejection, shared-policy bundling, 20/20 same-host DOM updates) from pending Maincloud authentication (401), full schema, durable StateStore adapter and actual office animation/approval wiring.
- [ ] Collect one clean backup of each completed moment. Label every cached response and replay with its original time.

## Main cut (175 seconds)

| Time / duration | Screen and action | Spoken/caption copy | Required evidence / capture owner |
| --- | --- | --- | --- |
| **0:00–0:25 / 25 s** | Open on the actual call: client asks for four payments and a fee waiver; show fee DENY, then a separate four-payment/no-waiver proposal escalates; avatar walks; Dana denies with passkey; agent relays on the same call. Split phone/transcript + office/approval. | Use the actual audio: “I can't waive the late fee… let me check with Dana on four.” Caption the policy quote and decision. | A+B+C: complete consented call, correlated audit/escalation/approval IDs, no prior amount disclosure. Policy returns first failing rule, so one denied fee proposal does not itself prove a second installment escalation. Never dub a response or manufacture one continuous call from different takes. |
| **0:25–0:35 / 10 s** | Product title over the office, badges readable. | “Backroom. Collections, payables, vendor onboarding. The owner keeps the controller seat.” | D: Aziz confirms final name; only say seats are operational if the integrated run supports them. |
| **0:35–0:50 / 15 s** | Synthetic studio card; optional approved interview excerpt with permission and role attribution. | “A small B2B agency still has invoices to chase and suppliers to pay. We want its owner to see what an AI clerk may do—and when it needs help.” | D: two-quote tracker; no invented customer or unverified market statistic. Label Northfield synthetic. |
| **0:50–1:15 / 25 s** | Open Collections badge; denied Treasury/vendor action; paired terminal proof from the same scenario with the browser closed. | “Badges are server rules. The same action is denied with the office closed.” | A+C+D: rule/version and parity artifact. B: matching door event. If only pure evaluator runs, caption **COMPONENT TEST**, and do not claim renderer/backend parity. |
| **1:15–1:35 / 20 s** | Current evidence cut: show live sandbox account/deposit/feed receipts, the returned zero balance and an explicit exception. Show reconciled success only after the balance gate is actually fixed and invoice matching is independently verified. | Current copy: “Nessie accepted the sandbox deposit, but its balance stayed zero. We flag the mismatch instead of marking the invoice reconciled. The card is simulated.” | B+C: preserve #42 successful reads/writes AND **T4 FAIL**; $1.25 was stored as 1, so fractional-dollar amounts are now rejected. No paid/reconciled state or local balance fabrication from deposit alone. A later success cut requires fresh before/deposit/after provider receipts, exact amount/memo and actual reconciliation. |
| **1:35–2:00 / 25 s** | Drop #4471 lookalike bank-change email into tray; hold and evidence; then show legitimate change reaching controller approval after verification. | “A new bank account is held for verification. The seat that proposes the change cannot pay it.” | A+B+C+D: #4471 rule evidence, separate legitimate case and actual passkey decision. CRS **SANDBOX TEST ID** and Apify **URL / OBSERVED AT** must remain distinguishable. Skip the legitimate completion claim if pending. |
| **2:00–2:20 / 20 s** | Ask “Why didn't you pay #4419?” Show answer and click cited evidence for #4402 and the +$37 variation. | Use actual answer. Caption whether output is **CLAUDE** or **CODE TEMPLATE**. | A+B+D: answer checked against key, cited IDs and both invoice values; Cartesia TTS only if it actually ran. Synthetic audit fixtures do not prove live signed state. |
| **2:20–2:45 / 25 s** | Legible results card; real/sim table; route, latency/cost and fallback evidence. | “Here are the complete run's results and what each service actually did.” | D+A: run/commit/key, numerators and denominators, failures included. If eval remains incomplete, show component evidence and explicit missing integration proof. T10 5-sample extraction results cannot stand in for suite metrics. |
| **2:45–2:55 / 10 s** | Office/controller plus project link, final real/sim labels. | “Would you hire it? You can watch it work.” | D: final links and readable closing frame. If the core loop is incomplete, close with the working scope instead of implying the whole office is ready. |

For a Cartesia-specific cut, confirm the current requirement before export. A provisional **2:00 cut** can retain call 0:00–0:25, title 0:25–0:35, policy/escalation 0:35–1:00, live voice/tool evidence 1:00–1:25, accurate limitations/real-sim proof 1:25–1:50, close 1:50–2:00. This is a separate edit of actual footage, not a second claim of integration.

## Backup order and drill captions

1. **Phone failure:** retry once, then use consenting team phone; if verified, same Cartesia Managed Agent in browser voice. If neither works, text simulator labeled **TEXT SIMULATION**, or recorded call labeled **REPLAY — call [ID], recorded [time]**. Do not present a replayed ring as live.
2. **3D failure:** fixed camera, then 2D floor plan/audit view using the same verified state. Report the actual view used.
3. **GX10 failure:** only call it automatic Claude fallback after a successful live trace. If cloud also fails, show the error/available code-only behavior; no generic “cloud fallback” success banner.
4. **CRS/Apify/Nessie failure:** try live, then labeled cache at the original timestamp; a mock must say mock. Cached CRS cannot establish live track use. For Nessie's observed zero-balance/fractional-dollar failures, retain the failed-gate caption and exception even though a deposit/feed call succeeded; a cache must not erase that contradiction.

## Recording and rehearsal log

| Item | Value |
| --- | --- |
| Tested commit / seed / frozen answer key | MISSING |
| Consent reference / approved public scope | MISSING; do not put private contact details here |
| Take / start PT / full evidence location | MISSING |
| Cartesia call/model/tool IDs and mode | MISSING |
| State backend / bank / CRS / Apify modes | MISSING |
| Nessie balance exception / recovery receipt and actual reconciliation | T4 FAIL per #42; no recovery or reconciliation proof yet |
| SpacetimeDB local T8 vs full application state | T8 local PASS per #43; Maincloud 401/full schema/durable adapter pending |
| Metrics run and route evidence | MISSING |
| Unedited source / 2:55 export / Cartesia cut | MISSING |
| Backup copies (two laptops + phone) | MISSING |
| Three rehearsals, Sun 5–6:30 AM | MISSING |
| Call-failure and GX10-down drill outcomes | MISSING |
| Component-owner review / Aziz final OK | MISSING |
