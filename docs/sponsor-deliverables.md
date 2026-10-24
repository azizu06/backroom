# Sponsor deliverable checklist (#31)

Prepared October 24, 2026 for Stream D. This is an evidence index, not a completion
certificate or a new live run. Read the receipt's commit, timestamp, route and
limitations before using a claim. Main moves rapidly; the Windows recheck below
covers f289054 only. No issue checkbox was changed by this documentation work.

| Required deliverable | Location | Remaining verification |
| --- | --- | --- |
| Cartesia setup, features, limitations | [README](../README.md#cartesia-setup-features-and-limitations), [configuration](cartesia.md), [call history](t1-cartesia.md) | A fresh authorized phone trace must prove the required disclosure and tool round trip; human passkey and whole-flow evidence stay separate |
| Real-versus-simulated table | [README](../README.md#real-versus-simulated) | Compare every recording shot to its actual transport and receipt; cached, fixture, sandbox, software-authenticator and simulated-card labels stay visible |
| CRS handling | [README](../README.md#crs-data-handling), [sandbox receipt](evidence/crs/live-run.json) | No business-credit/OFAC product exists in this sandbox. Do not claim these checks or change product wiring to satisfy the checklist |
| SpacetimeDB architecture | [README](../README.md#spacetimedb-architecture), [module](../spacetime/README.md), [state evidence](spacetime-state.md) | Preserve local versus hosted provenance and verify the actual demo host/configuration with its owner |
| Apify trace | [retained pre-call evidence](evidence/apify/README.md), [smoke evidence](apify-smoke.md) | Use exact receipt scope. Store publication and any new Maps scrape require explicit authorization; this task performs neither |
| Nessie boundary | [T4 evidence](t4-nessie.md), [payment/reconciliation](m7-payments.md) | A rising API account balance remains a separate bar; deposit/feed or locally displayed totals do not prove settlement |
| Evaluation proof | [current-main synthetic recheck](evidence/eval/current-main-windows-2026-10-24.md), [offline scoreboard](eval/scoreboard.md) | 34/34 answerKeyMatch does not execute every declared integration step; do not combine denominators or call scripted extraction model accuracy |

## Release checklist

- [ ] Review README sections against the actual recorded/live demo before sponsor signoff (team target: Sunday October 25, 7 AM PT).
- [ ] Supply receipts for a human passkey tap, authorized phone/disclosure/tool flow, and rising Nessie account balance, or report each unmet gate honestly. A partial call history cannot imply the whole flow.
- [ ] Keep P01 live pay/reconcile, P07/C15 live OFAC, C05 hostile, C08 wrong person, C09 Dana callback, C13 call-button/dial rejection, C14 email-only, C17 phone mismatch and C21 voicemail ungraded as whole integrations until executed by product code.
- [ ] Keep #14 open with its existing checkboxes. The key is signed; outside authorship remains 0/34.
- [ ] Tomi supplies two real owner/office-manager quotes with consent/provenance. Do not invent quotes, interviewees or outside authorship.
- [ ] Aziz explicitly approves Devpost submission (#32), which remains last. Team submission target: Sunday October 25, 7:30 AM PT; team hard cutoff 8:50 AM PT, per AGENTS.md. This task submits nothing.

P11/P12 are competitive, not MVP. This file does not move office issue #23 or CRS
issue #4 into Stream D. No office files, provider integration, Nessie display
formula, fixed WELCOME, policy or answer key are changed here.