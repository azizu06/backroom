# Devpost working draft

**Not published; Aziz must explicitly approve submission.** Text reflects reviewed evidence on Sat Oct 24, 2026. It is a useful draft, not a declaration that the integrated office works. Replace pending fields only from the [evidence checklist](evidence-checklist.md). Target: Sun Oct 25, 7:30 AM PT; hard cutoff 8:50 AM PT. Confirm final product name with Aziz; this draft uses the repository name, Backroom.

## Title and tagline

**Backroom: finance seats with limits you can see**

A back office for small B2B teams: AI clerks work within explicit permissions and bring exceptions to the owner.

## Inspiration

A small agency needs to collect late invoices, pay suppliers and check vendor changes, even when nobody has a finance job title. Giving an AI access to those tasks raises three practical questions: what can it do, what did it do, and when will it ask for help?

We chose owner-operators and office managers at 5–30 person B2B service firms as our community. Our synthetic example is Northfield Studio, a 14-person agency whose owner, Dana, remains the controller. We are gathering two real owner or office-manager accounts to test the problem framing. Those interviews are pending; Northfield and Dana are demo data, not customers.

**Before final publication:** use only approved wording from [the interview tracker](owner-quotes.md). If interviews do not happen, remove the pending sentence and say the problem framing has not been validated with users. The spec's Intuit statistics have not been verified from the primary report in this task; no numerical market claim is included here.

## What it does

The intended seats line is: **collections, payables and vendor onboarding; the owner keeps the controller seat.** Each clerk has a badge describing its actions and limits. Collections can propose a payment plan, Payables can pay an approved vendor inside a ceiling, and Vendor onboarding can propose a bank change but cannot pay. A model cannot approve its own exception.

Our lead demo is a collections conversation: a client asks for four payments and a waived late fee. Code refuses the fee waiver and routes the installment exception to Dana. The planned office view shows that escalation as a clerk walking to the owner's desk. A second case catches a lookalike-domain bank change; a third explains why invoice #4419 was held by citing the audit evidence for #4402.

**Final wording gate:** these are intended integrated scenarios. Change to completed behavior only after the actual call, controller authentication, state/view updates, payment and audit traces pass. If a moment is missing, describe the working subset and label the recording accordingly.

## What we have built and how

The merged policy package is pure TypeScript. It returns ALLOW, DENY or ESCALATE with a policy version; blocked decisions include an exact owner-policy quote. It enforces seat permissions and proposal limits using trusted structured inputs. Signals can narrow an envelope, and changing policy does not require rewriting a prompt. Transport code still has to persist decisions and enforce the caller responsibilities.

The merged ask-why service retrieves allowlisted audit projections and checks that cited IDs belong to that evidence. It has no payment, approval or state-writing tools. Provider failures or invalid responses produce a code-templated answer. A citation check proves which record was cited; a human still checks whether the explanation says the right thing.

The authenticated voice gateway and leased seat workers have merged (#36/#37); the local/cloud router remains an open PR in this evidence snapshot. Worker tests use fake external effects and an in-memory store. Gateway tests exercise the real policy evaluator, but T1 is setup only with no live Cartesia dial. Open PR #43 reports local SpacetimeDB T8 PASS: shared policy bundles, forbidden reducer writes are rejected, and 20/20 fresh row updates reached a browser DOM in 2–5 ms on the same host. Maincloud publication returned 401; the full schema, durable adapter and office behavior remain pending.

## Challenges and failure modes

Financial actions need a boundary outside the conversation. A persuasive email, invoice or caller is input data; it cannot become an approval. We separate model suggestions from the code that decides amounts, permissions and state transitions. The owner approval path is intended to require a verified passkey, never a voice instruction.

We also learned to keep different kinds of evidence separate. A successful extraction benchmark does not prove a full finance workflow. Optimized GX10 measurements reported five exact, schema-valid extraction outputs out of five for both a 20B model and Qwen 8B. The live router smoke then reached OpenRouter HTTP 402. Mocked fallback tests passed, but successful live Claude fallback remains unverified. Live Nessie customer/checking creation, deposits and feed reads succeeded in #42, while its hosted balance stayed zero after a completed whole-dollar deposit. A $1.25 request was stored as 1; the client now rejects fractional-dollar amounts. T4 therefore failed: a deposit alone is not reconciliation, and the mismatch must remain an exception. We will report the final run, including failures, rather than present the target as a result.

## Results and what we learned

At this snapshot, we can point to the merged policy and read-only explanation code and their component tests. The team is assembling the company dataset, frozen answer key and integrated evaluation. We do not yet have a measured trap catch rate, false-hold rate, policy-violation count, local-call share or voice latency for the full system.

**Replace this paragraph with actual results when available:** “On revision [COMMIT], [MATCHED]/[TOTAL] scenarios matched the frozen answer key; [CAUGHT]/[TRAPS] planted traps were caught, and [FALSE]/[LEGITIMATE] legitimate cases were wrongly held. We recorded [VIOLATIONS] policy violations across [ACTIONS] actions. [LOCAL]/[MODEL_CALLS] model calls ran locally. The full run and limitations are linked at [ARTIFACT].” Never publish bracketed placeholders or substitute targets for measurements.

## What's next

Finish and verify the consented phone core loop, durable state adapter, authenticated controller decisions and sandbox-bank reconciliation. For real deployment, replace the simulated card with an actual payment rail and validate operating procedures, privacy controls and recording/consent requirements. Expand the evaluation with cases written by people outside the team, and measure where the clerk saves owner time without creating unnecessary approvals.

## Submission fields and sponsor attribution

| Field | Draft / completion rule |
| --- | --- |
| Project URL | MISSING: working deployment, checked from another device. |
| Repository | `https://github.com/azizu06/backroom`; confirm public access and final revision. |
| Demo video | MISSING: actual-run 2:55 cut; separate ~2 min Cartesia cut if current rules require it. |
| Built with now | TypeScript, Next.js, React Three Fiber scaffold, deterministic policy, read-only audit explanation. Confirm versions from final lockfile if requested. |
| Conditional additions | Cartesia, SpacetimeDB, CRS, Nessie, Apify, Anthropic/OpenRouter, GX10/Ollama: describe exact working role and link proof before claiming integrated use. Local GX10 inference has reported T10 receipts in open #40; full routing is unverified. |
| Apify link / run | MISSING: published Actor, README, input schema, real run/time/cost receipts. |
| Real vs simulated | Use the checked [table](sponsor-readme-draft.md); synthetic company, CRS test identities, Nessie sandbox and simulated card remain explicit. |
| Team / contribution | MISSING: human-approved names and contributions. Do not publish private eligibility responses. |
| Tracks | Aziz verifies current rules and meaningful live use from the sponsor checklist; omit unsupported tracks. |
| Submission approval | MISSING: Aziz's explicit OK on final copy, media and tags. Record authorization reference privately if it contains private information. |
| Confirmation | MISSING: submitted time and confirmation URL/screenshot after authorized submission. |

Before publishing, delete internal instructions, reconcile every pending claim against final evidence and have the component owners review their attribution. Do not state that Cartesia uses Claude in-call until its catalog/configuration is verified. Do not state that routine data never leaves the office when a cloud path or third-party voice service handles it; describe the actual route and fields instead.
