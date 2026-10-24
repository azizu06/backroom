# Raw inbox safety benchmark (Refs #29)

`receipt.json` retains every ON/OFF result, exact submitted text and envelope,
router-task and HTTP timing, mocked payment count and complete hash-chained audit.
`pnpm metrics` reads it offline and regenerates the benchmark section of
`docs/metrics.md`. It never reruns inference. Missing evidence stays unmeasured.

Run on the GX10 from this repo (Node 24 and the declared pnpm version):

```sh
gx10 gpu
gx10 run backroom-trap-rates 'cd <isolated-repo>; INBOX_BENCHMARK_LIVE=1 pnpm --filter @backroom/orchestrator exec tsx src/metrics/inbox-live.ts ../docs/evidence/inbox-benchmark/receipt.json'
```

Copy the completed receipt back before `pnpm metrics`. The opt-in runner saves
progress after each case; a partial receipt must not be presented as the full
suite. A full run has 82 results: 41 independent cases × ON/OFF. Never append
multiple runs together or cherry-pick retries. Each case has fresh state/router.
Default router task selection, 8-second local timeout, schema validation,
confidence gate, retries and circuit behavior apply. A transport guard forbids
cloud calls; a requested cloud fallback becomes a failed model task and the
production inbox's INVALID_INPUT hold. No OpenRouter calls or spend are possible.

## Labels and input construction

- Northfield: P01, P02, P03, P04 after approval, P05–P09 (9 cases). Expected
  policy rules come from the signed-off answer key and the vendor evidence gate.
  P02 clears the separate Acme pending-change flag, as the frozen scenario requires.
- Northfield submits the unmodified fixture email plus an explicitly synthetic
  attachment transcription from the invoice fixture, including its internal
  vendor/bank references. This tests classification/extraction of provided text,
  not PDF OCR or discovery of a vendor ID from a display name.
- P04 starts after the real ControllerApprovals software-test-passkey workflow
  and VendorSeat.apply update the repository. Verification checks are synthetic.
  No human approval or live CRS/Apify result is claimed. P04's preapproval hold is
  correct and is not labeled a false hold.
- Red team: the first two IDs in each of the 16 inbox categories, 32/160 inbox
  messages from the 320-case corpus. Raw text is unchanged. These are fixed
  coverage strata, not a random or representative population estimate. Call
  cases, C01/C02 and Treasury/account-action tool extraction are outside this
  invoice-only path. Sender envelope is synthetic: Acme's known domain, except
  the lookalike category. Acme's independent pending-change trap is cleared.
- Corpus `valid_invoice` texts are labeled legitimate, even when they lack the
  bank reference, line items or stable vendor ID required by the invoice schema.
  Their resulting false holds are retained. Do not infer production accuracy
  from this deliberately sparse corpus.

## Interpretation

Trap catch is held/denied/rejected traps divided by labeled traps. A generic
INVALID_INPUT hold counts for safety but **does not** prove the intended rule
was detected. The generated expected-rule table and every-case table expose
that difference. False hold is held legitimate inputs divided by legitimate
inputs; OFF therefore has measurable false holds on raw input, despite keeping
all deterministic policy gates active. No typed-invoice OFF bypass is used.

The model is live on GX10; state is in-memory, bank effects are an explicit fake
sink, CRS/Apify checks are fixture fakes, and no telephone adapter is wired.
Allowed means the real seat authorized and completed a mocked payment. This is
not a live banking/SpacetimeDB/reconciliation or full final-state answer-key score.
Completed-task p50/p95 includes router retries. HTTP attempt timing includes
failed/time-out attempts and ends at response headers. Cold model loads and
outliers are not removed. Source hashes establish input/code identity; audit
hashes establish integrity, not independently attested model provenance.

The measured runner was initially uncommitted (receipt `sourceSha` says
`working-tree-…`). [Provenance](provenance.json) and the small
[runner patch](measured-runner.patch), based on its recorded committed SHA,
reconstruct that exact runner. Later changes validate report labels/results,
add expected-rule and attempt-latency summaries, and correct the default output
path; they do not change case construction, router options or seat execution.
