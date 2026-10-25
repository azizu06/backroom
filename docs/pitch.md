# Judge pitch + demo video shot list

Docs-only table script. Source of truth for clicks and expected evidence:
[demo-runbook.md](demo-runbook.md). Do not invent capabilities the host cannot
show. Keep **System Status** and mode labels (mock / sandbox / TESTNET / REPLAY)
visible. Never display operator codes, enrollment secrets, or private origins.

Locally store the finished video and per-moment backup clips on two laptops and
a phone. This file is not a Devpost submission.

## Roles (every take)

| Role | Person | Ready when |
| --- | --- | --- |
| Presenter / narrator | — | Office open on the printed public HTTPS origin |
| Caller (Jordan) | — | Consented test target; hears AI disclosure before any amount |
| Dana | — | Controller open on her phone; passkey enrolled on **this** origin |
| Backup operator | — | Can Reset company, Reload the office, and switch to labeled offline replay |

Before every take: operator **Sign in** → Dana **Sign in with passkey** →
**Reset company** → **Confirm** → **Reload the office** → Operator Advanced
**Check dependencies** / **Run preflight** → confirm **State connected**. Engineer
runs `node tools/judge-check.mjs --live-origin <private>` beforehand; PASS is not
proof of a completed live dial.

---

## 3-minute live table pitch (~180s)

Demo-first. Speak over what the screen actually shows. If a step fails, say the
observed failure and use the prepared backup; do not approve by voice or invent
a confirmed plan.

| Time | Presenter says (approx.) | On screen / action | Must show |
| --- | --- | --- | --- |
| 0:00–0:15 | “Backroom is a walkable AI back office for a small B2B studio. Code owns money and the record; the model owns language inside a box. Dana keeps the only approval seat.” | Office orbit (or Play); **State connected**; Real-vs-sim / System Status visible | Product name **Backroom**; connection label |
| 0:15–0:35 | “Collections calls Jordan about overdue invoice 1042. This is an AI assistant for Northfield Studio, and the call is recorded.” | Collections desk → **Request call**; fixed welcome finishes | AI disclosure + recording notice **before** amount/terms |
| 0:35–0:55 | “Jordan confirms identity. Only then do we talk money.” | Caller answers the Jordan identity question | No plan discussed before identity |
| 0:55–1:20 | “Jordan asks: seven installments, fifteen percent first, over thirty days — keep the late fee, no discount. That’s outside Alex’s badge, so the agent escalates to Dana. It does not rewrite the plan or treat speech as approval.” | Folder walk / escalation; agent says it will check with Dana | Exact out-of-badge terms; escalation, not silent ALLOW |
| 1:20–1:40 | “Dana reviews 7 / 15% / 30 days on her Controller and approves with her passkey — never by voice, never by the model.” | Dana phone: live request → **Approve with passkey** → **Your decision is recorded.** | Passkey prompt; recorded decision |
| 1:40–2:00 | “Alex confirms the exact approved plan and offers the payment link.” | ~15s for approval check + link offer; **Calls → Payment link ready** | Exact plan; link for **this** call |
| 2:00–2:15 | “Jordan pays seven hundred forty-three dollars on the authorized pay page.” | **Pay $743.00** → **Payment matched. Invoice partially paid.** | Say bank mode: mock Nessie vs live sandbox (still sandbox money) |
| 2:15–2:30 | “Audit wall: amount match, invoice 1042 partially paid, collections → reconciler → auditor.” | **Audit wall**; current call evidence | Real receipts, not a generic “done” row |
| 2:30–2:45 | “Same office holds AP attacks. Scripted Attack lab: lookalike bank change — hold, money moved no, payment attempts zero.” | **Attack lab → Lookalike… → Run attack** (Scripted) | `BANK_CHANGE_HOLD`; Money moved: no; attempts: 0 |
| 2:45–2:55 | “Operator can start the workday (three invoices + one bank-change trap, no payments) and, when the host is armed, a one-cent x402 **TESTNET** vendor pay. Ask the wall why — answers cite receipts.” | Brief Workday and/or x402 **TESTNET** receipt **or** say unavailable; Audit ask-why | Label **TESTNET** / $0.01 test USDC; never present OFFLINE as testnet |
| 2:55–3:00 | “Would you hire a clerk you can watch? Seats work; Dana decides; every decision is on the wall.” | Hold Real-vs-sim / System Status | Honest close; no unshown claims |

### If the live call is unavailable

Say so. Use the prepared offline standby bookmark
`/office?replay=core-offline` (or Help → **Watch a recorded session**). Keep the
**REPLAY** banner visible. That recording is synthetic state/audit with **no call
audio** — do not call it a live phone proof. Pair a separately stored call clip
if you need voice.

### Truth labels (say out loud when relevant)

| Shown | Honest wording |
| --- | --- |
| Mock bank / `DEMO_LIVE=0` | “Mock Nessie receipt — rehearsal, not a Capital One production transfer.” |
| Live sandbox Nessie | “Sandbox deposit — still test money.” |
| x402 **TESTNET** | “Base Sepolia test USDC, about one cent, once per host process.” |
| x402 **OFFLINE** | “Simulated only — not a chain payment.” |
| Attack lab **Scripted** | “Deterministic stand-in agents; no model call.” |
| Attack lab **Live** | Separate opt-in; not a payment route. |
| SpacetimeDB connected | “Stored state for this run — not proof every adapter is durable.” |
| `judge-check` PASS | “Scripted path + read-only live probes — not a completed dial.” |
| Offline replay | “Recorded standby — zero live APIs; not a fresh integration.” |

---

## Locally stored demo video — shot list (~2:55–3:00)

Record on the prepared host after Reset. Prefer one continuous take for the call
arc; cut only for title/proof cards. Captions OK; do not fake UI in post. Store
master + per-shot backups locally (two laptops + phone). Blur secrets and private
URLs.

| # | Time | Shot / framing | Audio / VO | On-screen proof | Backup clip name |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:12 | Title: **Backroom** + seats line (Collections / Payables / Vendor; Dana = approver) | Soft bed or silence | Product name correct | `01-title` |
| 2 | 0:12–0:25 | Problem beat (one sentence) | VO: small B2B studio, overdue AR, no finance hire | Office establishing | `02-problem` |
| 3 | 0:25–0:40 | Pre-call: System Status + State connected; optional CRS/Apify labels | VO: “Code checks identity and policy; we disclose AI before amounts.” | Visible mode badges | `03-preflight` |
| 4 | 0:40–0:55 | **Request call**; welcome with AI + recording disclosure | Call audio (or labeled browser/text take) | Disclosure before money talk | `04-disclosure` |
| 5 | 0:55–1:05 | Identity confirmation (Jordan) | Call audio | Identity before amount | `05-identity` |
| 6 | 1:05–1:25 | Plan negotiation: 7 installments / 15% / 30 days; escalation to Dana | Call + office folder walk | Out-of-badge → escalate | `06-escalate` |
| 7 | 1:25–1:40 | Dana Controller: review terms → **Approve with passkey** | Phone mic / room; no secret codes | Passkey UI; decision recorded | `07-passkey` |
| 8 | 1:40–1:55 | Agent confirms exact plan; payment link ready | Call continues | Exact approved terms | `08-confirm` |
| 9 | 1:55–2:10 | **Pay $743.00** → matched / invoice 1042 partially paid | Narrate bank mode | Pay page + match string | `09-pay` |
| 10 | 2:10–2:25 | Audit wall: match, partially_paid, seat chain | VO: “Claude talks; code decides; wall records.” | Linked receipts | `10-audit` |
| 11 | 2:25–2:35 | **Start the workday** (or cut to Workday panel mid-run) | VO: three invoices + bank-change trap; **no payments** | Workday panel / receipts | `11-workday` |
| 12 | 2:35–2:45 | Attack lab Scripted lookalike → hold | VO: “Money moved: no.” | `BANK_CHANGE_HOLD`; attempts 0 | `12-attack` |
| 13 | 2:45–2:52 | x402 **TESTNET** $0.01 **or** skip with on-screen “TESTNET not armed” | VO must say TESTNET / test USDC if shown | Actual receipt **or** honest skip | `13-x402` |
| 14 | 2:52–3:00 | Real-vs-sim table + close | VO: “Would you hire it? You can watch it work.” | Real vs sandbox/mock/TESTNET | `14-close` |

### Optional B-roll (store, do not force into the 3:00 cut)

- Help → **Watch a recorded session** → REPLAY banner + scrub (labeled standby).
- Ask why on Audit wall with cited rule ids.
- Policy badge page (operator unlock ≠ Dana approval).
- Floor plan / Full Screen only if 3D is stable.

### Edit checklist

- [ ] No operator code, enrollment secret, or private live origin in frame or audio.
- [ ] Every money shot labeled mock, sandbox, or TESTNET as applicable.
- [ ] Offline replay never captioned as a live call.
- [ ] x402 OFFLINE never captioned as TESTNET.
- [ ] Filename/date on local masters; two-laptop + phone copies before venue Wi-Fi.

---

## Mapping to runbook sections

| Pitch / shot | Runbook |
| --- | --- |
| Call → Dana → pay → audit | [Call → Dana → payment → audit](demo-runbook.md#call--dana--payment--audit) |
| Workday / Attack lab / x402 | [Other table moments](demo-runbook.md#other-table-moments) |
| Offline standby | [Offline standby](demo-runbook.md#offline-standby) |
| Preflight / reset | [Before every take](demo-runbook.md#before-every-take) |
