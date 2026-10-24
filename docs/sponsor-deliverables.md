# Sponsor deliverable checklist (#31)

Prepared October 24, 2026 for Stream D. This is an evidence index, not a completion
certificate or a new live run. Read the receipt's commit, timestamp, route and
limitations before using a claim. Main moves rapidly. The Windows recheck linked
below covers f289054 only and stays a historical command log. The offline
scoreboard file is unchanged from #228 (`3368339`) through main `7830261`. No
issue checkbox was changed by this documentation work.

| Required deliverable | Location | Remaining verification |
| --- | --- | --- |
| Cartesia setup, features, limitations | [README](../README.md#cartesia-setup-features-and-limitations), [configuration](cartesia.md), [call history](t1-cartesia.md) | A fresh authorized phone trace must prove the required disclosure and tool round trip; human passkey and whole-flow evidence stay separate |
| Real-versus-simulated table | [README](../README.md#real-versus-simulated) | Compare every recording shot to its actual transport and receipt; cached, fixture, sandbox, software-authenticator and simulated-card labels stay visible |
| CRS handling | [README](../README.md#crs-data-handling), [sandbox receipt](evidence/crs/live-run.json) | No business-credit/OFAC product exists in this sandbox. Do not claim these checks or change product wiring to satisfy the checklist |
| SpacetimeDB architecture | [README](../README.md#spacetimedb-architecture), [module](../spacetime/README.md), [historical standalone evidence](spacetime-state.md), [hosted parity receipts](evidence/maincloud-parity/README.md), [current host operations](demo-runbook.md) | Preserve local versus hosted provenance and verify the actual demo host/configuration with its owner |
| Apify trace | [retained pre-call evidence](evidence/apify/README.md), [smoke evidence](apify-smoke.md) | Use exact receipt scope. Store publication and any new Maps scrape require explicit authorization; this task performs neither |
| Nessie boundary | [T4 evidence](t4-nessie.md), [payment/reconciliation](m7-payments.md) | A rising API account balance remains a separate bar; deposit/feed or locally displayed totals do not prove settlement |
| Evaluation proof | [current-main synthetic recheck](evidence/eval/current-main-windows-2026-10-24.md), [offline scoreboard](eval/scoreboard.md) | Use the scoreboard rows below. 34/34 answer-key checks still leave 22/34 scenarios with an unexecuted integration step. Do not combine those denominators, and do not call the recorded PDF row a new model run |

## Offline scoreboard cited here

These figures are the committed scoreboard at `3368339`, still the file on main
`7830261`. They are code-path results. They are not a phone call, a human passkey
tap, a live CRS/OFAC probe, or a Nessie settlement.

| Scoreboard row | Result | What it does not prove |
| --- | --- | --- |
| Recorded PDF extraction, GX10 gpt-oss:20b | 579/581 fields; 81/83 invoices exact | Not re-run for this note. Provenance hashes `docs/eval/pdf-extraction.json` as `762e09694c6605dcb77c36fb5c84364ffc6248e04c05d8a17e54e709d7ff4e90` |
| AR scripted calls, including C05 hostile, C08 wrong number, C09 human request, C21 voicemail | 9/9 | Caller lines and tool choices are scripted. No Cartesia speech, live phone, or de-escalation grade |
| Pre-call stops C11, C13–C16, C22 | 6/6 | Planner and dial path over an injected stub. Not a live CRS/Apify/OFAC product call |
| In-app call button and pre-call gate | 6/6 | No provider dial leaves the stub. A second click stays on cooldown |
| Demo inbox agent team | 1/1 | Scripted QueryFn. `VENDOR_CRS` is pinned fake for the run. Not the Cedar passkey write |
| C5 judge calls | 7/7 | Unrecognized requests escalate and are tagged `scenario_source: judge` |
| Live-call approval expiry and one re-escalation | 14/14 | Injected clock. Not a human passkey tap |
| Scenarios with no unexecuted integration step | 22/34 | The other 12 stay partial |

## Release checklist

- [ ] Review README sections against the actual recorded/live demo before sponsor signoff (team target: Sunday October 25, 7 AM PT).
- [ ] Supply receipts for a human passkey tap, authorized phone/disclosure/tool flow, and rising Nessie account balance, or report each unmet gate honestly. A partial call history cannot imply the whole flow.
- [ ] Keep whole live integrations ungraded: P01 live pay-and-reconcile, live OFAC, a human passkey tap, an authorized phone with disclosure and tool round trip, C14 email-only follow-up, C17 phone mismatch, and a rising Nessie account balance. The scoreboard rows above measure scripted product paths for C05, C08, C09, C21, the pre-call stops, and the in-app call button. Those rows do not close this item.
- [ ] Keep #14 open with its existing checkboxes. The key is signed; outside authorship remains 0/34.
- [ ] Tomi supplies two real owner/office-manager quotes with consent/provenance. Do not invent quotes, interviewees or outside authorship.
- [ ] Aziz explicitly approves Devpost submission (#32), which remains last. Team submission target: Sunday October 25, 7:30 AM PT; team hard cutoff 8:50 AM PT, per AGENTS.md. This task submits nothing.

P11/P12 are competitive, not MVP. This file does not move office issue #23 or CRS
issue #4 into Stream D. No office files, provider integration, Nessie display
formula, fixed WELCOME, policy or answer key are changed here.
CRS implementation note: existing consumers use public-record bankruptcy stops and fraud-risk holds, with fake defaults and opt-in sandbox credentials. The retained P06 client probe is not the pending credentialed P07/P13 consumer-wiring receipt. OFAC remains unavailable; no integration is changed by this checklist.
