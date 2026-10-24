# Current-main Stream D recheck (Windows)

Date: October 24, 2026 (Pacific). Repository: azizu06/backrooms.
Checked commit: f289054, on branch 29-current-main-evidence created from the fetched origin/main. Eval stack commit 88275e5 is an ancestor of this commit. The already-merged 14-vendor-evidence-eval branch was not modified.

## Observed results

- `pnpm eval:run --graded`: exit 0; 34/34 reports contain answerKeyMatch=true; 34 conversations in 0.09s; signoff=approved; gradedEval=run-1.
- `pnpm demo:core` (without --live): exit 0; final summary says core loop, both bank-change traps, LLM OFF and audit chains pass. The summary explicitly separates phone, human passkey and T4 live gates from this synthetic run.

These commands use scripted/fixture paths. No phone dial, new Maps scrape, Store publication, Devpost submission, or live-service probe was performed for this recheck. This is not a fresh live call, human passkey tap or bank-settlement receipt. No source behavior or expected answer was changed.

## Interpretation limits

An answer-key match is not proof that every declared integration step executed. The CLI still explicitly states that other integration steps were not executed and issue checkboxes stay open. Its P11/P12 and C21 rows include declared operations rather than executed integration evidence.

Keep these must-ship paths ungraded as complete integrations until product execution proves the entire operation: P01 live pay-and-reconcile; P07/C15 live OFAC; C05 hostile handling; C08 wrong person; C09 Dana callback; C13 call button plus dial rejection; C14 email-only path; C17 phone mismatch; C21 voicemail. Policy outcomes for those cases can still match the key. P11/P12 are competitive rather than MVP.

The executed fixture/software paths include P04 bank-change verification, C10/C11/C12 persisted stops, C11 payment-link probe, C16 closed-business stop from a fixture Apify transport, C02 partial payment after sandbox reconciliation, C03 four-pay denial followed by the two-pay offer, C04 discount refusal keeping the full total, C01 payment only after identity, and P08 unverified-vendor hold. A software authenticator is not a human passkey tap; fixture transports are not live CRS/Apify/Nessie proof.

## Remaining evidence boundaries from the takeover

- Northfield key is signed by triumph! for eval run #1. Issue #14 stays open with its existing checkbox state; outside authorship remains 0/34.
- Two real owner quotes are Tomi's human task. This recheck supplies neither quotes nor interviews.
- PR #89's recorder fix does not prove the exact disclosure or a successful phone-tool round trip. Another call needs a fresh go from Aziz/Firstmate; no redial here.
- A human passkey tap and a rising Nessie account balance remain separate acceptance evidence. Posted deposits and displayed account balance are not interchangeable or proof of settlement.
- CRS business credit/OFAC cannot be claimed from the sandbox's other products. No public-records/fraud-risk wiring was added by this work.
- Diego's #23 and office code and Anthony's CRS code remain with their owners.
- Devpost #32 remains last and requires Aziz's explicit submission instruction.

Read the live board (issue #1), current AGENTS.md and docs/spec.md before updating this snapshot. Subsequent main commits need a new recheck; these results describe f289054 only.