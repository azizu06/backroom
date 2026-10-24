# Measured ten-company GX10 burst

Run from source commit `4ec6e02cb5f931bf04a9cf1b5847d0a292aa7b77`:

```sh
pnpm demo:burst -- --companies 10 --month 2026-09 --concurrency 2
```

`summary.json` records measured processing wall time, actual returned usage,
throughput, GPU preflight, manifest hash, local share, every hold count, model
failures and original ordinary-hold labels. `items.jsonl` preserves all 370
original item events, including their audit records. Repeated heartbeat/progress
events are omitted; `sourceEventsSha256` identifies the full local source log.
The original run artifacts remain in `.demo/burst/1792848112217-6d857d96/` on the
worker worktree. Generation is deterministic from the source commit and month;
`manifestSha256` hashes the generated manifest array.

The command completed all items and exited **1**: five model tasks failed and
one expected duplicate rule was absent, while every planted trap remained held.
Four failures were low confidence; one was invalid extraction schema. The
`cloud_fallback` transport diagnostics describe the local guard rejecting an
attempt before HTTP, not a cloud request. All actual inference was on GX10;
bank effects were simulated and no call or external vendor check was available.

The raw `falseHolds=30` counter includes seeded risky vendors labeled ordinary
by this workload. The runbook explains those 30 records; this is not a calibrated
false-hold error rate. Labels are preserved as run, with no post-result relabeling.
Full 25-company throughput and a laptop baseline were not measured.
