# Offline agent eval scoreboard

**Synthetic deterministic mock run. These are code-path results, not live model accuracy or production fraud-detection estimates.**

Reproduce from the repo root after `pnpm install --frozen-lockfile`:

```sh
pnpm --filter @backroom/orchestrator exec tsx src/agents/eval/scoreboard.ts
```

Base commit: `ef3d8a060bc122840aae1093cb00e6348ac427a2`. Answer key: northfield-v1; signoff: **approved**.
Frozen manifest verified: 170 files.
Input SHA-256 hashes and item-level observations are in [scoreboard.json](scoreboard.json).

| Measurement | Result |
| --- | --- |
| Extraction field fidelity, fixture-fed mock (8 fields × 83 invoices) | 664/664 (100%) |
| Source/PDF extraction accuracy | Not measured |
| Initial AP pay/hold decisions vs key | 10/10 (100%) |
| Vendor fraud catch (lookalike sender only) | 1/1 (100%) |
| Duplicate catch | 1/1 (100%) |
| All keyed AP holds caught | 9/9 (100%) |
| False holds on keyed clean ALLOW steps | 0/1 (0%) |
| Authoritative AP decision rule agreement | 9/9 (100%) |
| Collections pre-call permit agreement | 8/8 (100%) |
| Keyed bank-feed reconciliation agreement | 4/4 (100%) |
| P11 expired memory activation recovery (late tool/cancel variants; no OS kill) | 2/2 (100%) |
| P10 Collections dispatcher tool isolation (not policy rule agreement) | 1/1 (100%) |
| P04 dispatcher bank-change application (software passkey, fixture providers) | 1/1 (100%) |
| P04 missing/denied/spoken approval guards | 3/3 (100%) |
| Existing eval answer-key checks (partial execution permitted) | 34/34 (100%) |
| Existing eval scenarios with no unexecuted integration step | 22/34 (64.71%) |

## Coverage and limits

- **apItems**: 83
- **arItems**: 10
- **scenarios**: 34
- **apRuntime**: Production ClaudeAgentRuntime + Dispatcher + role registry + handoff store + in-memory usage ledger; injected scripted QueryFn.
- **arRuntime**: Real collections permit and reconciler/auditor DomainTools; direct tool-script seam, not dispatcher or voice conversation.
- **extraction**: Oracle-fed fixture mock; schema and evidence fidelity only. 8 equally weighted fields per AP item; lineItems is one exact-match field; absent optional adjustment matches absent.
- **providers**: Synthetic GX10, bank, CRS public-records and Apify responses. No network calls, keys, real calls or money. Positive runtime cost entries are synthetic accounting tests, not spend.
- **fraudDefinition**: Only key steps with LOOKALIKE_DOMAIN; one planted fraud item. Sanctions and routine bank-change holds are not relabeled fraud.
- **payablesDefinition**: Keyed invoice initial pay/hold decisions and P08 evidence gate; includes P03 sender variants. P04 has a separate two-dispatcher-run bank application measurement. P10 probes Collections tool isolation; NOT_IN_BADGE stays a separate direct policy reference. P11 measures expired memory activation takeover after a persisted mock receipt, not an OS kill or durable restart. P12 failover remains a legacy gap.
- **recovery**: Production runtime/dispatcher, expired-activation takeover and Payables replay on retained memory state. Scripted query abandoned after the mock receipt was persisted, before handoff/completion; no OS process kill, durable restart, uncertain debit retry or real provider debit.
- **badgeAttack**: Production Collections planner + Dispatcher/ClaudeAgentRuntime with scripted QueryFn and real PreToolUse/schema gates. No payment tool or bank adapter is available; no payment execution or human/voice approval is claimed. Policy NOT_IN_BADGE is a separate direct evaluator reference.
- **bankChange**: Scripted QueryFn through production runtime/dispatcher; production VendorSeat/ControllerApprovals; software passkey, fixture CRS/Apify and bank. No human tap or live provider proof.
- **falseHoldDefinition**: Keyed ALLOW invoice steps held / all keyed ALLOW invoice steps. Historical paid invoices excluded from this denominator.
- **unscored**: The 83 raw AP runs and 10 AR runs are coverage, not 93 labeled ground-truth decisions. Only explicit answer-key labels count toward accuracy.

- Every AP invoice runs from a fresh repository snapshot, including historical invoices. Every AR invoice gets a reconciliation trial; every scenario is visited by the existing eval and every collections scenario gets a permit probe.
- Initial AP decisions retain the required legitimate-bank-change hold and do not count it as a false hold. Separately, P04 runs the production runtime/dispatcher before and after VendorSeat applies a ControllerApprovals-verified software passkey receipt on the same repository. This is two cases around a code-owned human boundary, not an autonomous agent approval or human tap. No role was tuned to the key.
- The frozen key has 34 team-authored scenarios and zero external scenarios. Small planted-trap denominators cannot support a general fraud-detection claim.

## Disagreements and unexecuted evidence

- **P03/1:signals**: Tool signal list [] differs from key [BANK_CHANGE_HOLD]; authoritative sealed decision is [BANK_CHANGE_HOLD]. Signal lists and decision rules are distinct.
- **P04/0:signals**: Tool signal list [] differs from key [BANK_CHANGE_HOLD]; authoritative sealed decision is [BANK_CHANGE_HOLD]. Signal lists and decision rules are distinct.
- **P07/0:signals**: Tool signal list [PAYEE_NOT_IN_MASTER,OFAC_STOP] differs from key [OFAC_STOP]; authoritative sealed decision is [OFAC_STOP]. Signal lists and decision rules are distinct.
- **P01**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **P07**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **P11**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **P12**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C05**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C08**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C09**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C13**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C14**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C15**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C17**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C21**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **AR_RUNTIME**: AR probes exercise real specialist DomainTools with a Collections reducer lease, but do not drive the dispatcher/post-call role or a voice conversation. Those end-to-end runtime outcomes remain unmeasured.

## Keyed AP items

| Item | Invoice | Expected | Actual | Exact rule match |
| --- | --- | --- | --- | --- |
| P01/0 | 4401 | ALLOW | ALLOW | true |
| P02/0 | 4419 | HOLD | HOLD | true |
| P03/0 | 4471 | HOLD | HOLD | true |
| P03/1 | 4471 | HOLD | HOLD | true |
| P04/0 | 4480 | HOLD | HOLD | true |
| P05/0 | 4481 | HOLD | HOLD | true |
| P06/0 | 4482 | HOLD | HOLD | true |
| P07/0 | 4483 | HOLD | HOLD | true |
| P08/0 | 4484 | HOLD | HOLD | workflow gate |
| P09/0 | 4485 | HOLD | HOLD | true |
