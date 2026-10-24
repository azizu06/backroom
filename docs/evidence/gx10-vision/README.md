# GX10 invoice vision (Refs #22 #14)

The inbox API accepts PDF/PNG/JPEG/WebP attachments and runs
`processInbox -> renderInvoiceDocument -> route('document_extraction') -> invoiceSchema -> PayablesSeat`.
Models receive only page images and the accompanying untrusted email. They receive
no tools, master-write capability, approval flag or payment authority. Code still
checks the sender, vendor master, PO, duplicates, amount and bank account.

Final measurement: **9/12 exact invoices (75%); 105/108 exact structured fields
(97.22%); p50 7.92s / p95 10.19s**. All 9 trap runs held; 0/3 clean false holds.
The correct expected rule matched 9/12 runs. The final run used an already-loaded
model after earlier tuning runs; cold-load time remains in `baseline.json`.
This misses the original T10 <=3s target. The repeated four-case set is too small
and too tuned to claim general invoice-reading accuracy.

## Contract for the tray

Existing `POST /api/inbox`, same-origin multipart: `kind`, `text`, `senderDomain`,
optional `attachment`. Limits: 4 MiB upload; 4 PDF pages; 16M input image pixels;
1600 px longest output edge. Invalid/password-protected/unrenderable documents, insufficient
facts, OFF and low confidence return the existing held decision receipt. They never
fall back to the email-only deterministic parser to bypass a failed attachment.

The existing `fields`, `decision`, `evidenceRefs`, `escalationId`, `attachment`
(name/type/size/SHA-256), `auditId`, `auditHref` and `notice` remain. New fields:

- `attachmentParsed: boolean`: schema-valid invoice fields were accepted.
- `documentRoute: 'local' | 'cloud_fallback' | null`: completed extraction route;
  null means no accepted extraction, **not** proof that no provider saw the document.
- A `document_extracted` audit records model, route, pages, latency, cost and
  `cloudDocument`; it contains no image bytes/base64. File bytes are not retained
  by this intake. Extracted fields and the caller's email remain in the audit.

This judge intake still has **no bank adapter**. Clean uploads can reach policy
but cannot debit an account. A production seat may use its existing payment
adapter only after the same checks; the model cannot select that adapter.

## Routing and privacy

Dedicated local model: `qwen2.5vl:7b` (`GX10_VISION_MODEL` override). Vision has a
120s local request timeout, independent of the text router's 8s timeout and 5s
rolling health threshold. A slow text model cannot silently route a private scan
straight to cloud. Transport failure, disabled local routing and low confidence
hold documents locally. Exactly two local JSON-envelope/schema failures can
escalate to the configured cloud provider (Anthropic by default), using image
content blocks and the same authoritative schema.

**Do not claim all documents always stay on-site.** That fallback transmits page
images and accompanying text. Success notices disclose a completed cloud route;
failure notices disclose that fallback may have been attempted. No live cloud
request was made in these measurements. The live benchmark transport explicitly
blocks non-GX10 requests, including fallback.

PDFium is bundled as WASM and executes in a disposable Node worker with a 20s
render deadline, bounded page dimensions/count and a 128 MiB JS heap limit. No
host Poppler/Python dependency or persistent temporary document is needed. PDFium
package resolution happens **inside** the worker: Turbopack rewrites a parent
`require.resolve()` to a numeric module ID, which cannot be passed to Node's
worker `require()`. `web/next.config.mjs` includes the PDFium files in the inbox
production trace. Run the API from the workspace root, `web/`, or `orchestrator/`;
those are the supported package lookup locations. The production smoke verifies
the built API, native worker and two-page image request, rather than only a module
unit test.

## Fixtures and measurement

[Fixtures](../../../fixtures/vision/README.md) are four synthetic Northfield
derivatives, three repeats per case. Stable vendor/bank references are visibly
added because original PDFs omit them. Expected fields are used for scoring only,
never as model input. This is fixture-tuned engineering evidence, not held-out OCR
accuracy or a population estimate. The handwritten-ish case uses skewed italic
print, not actual handwriting. No real financial data is in this set.

Each receipt retains per-field exact matches, code outcomes, full audit chains,
local request/fallback failure counts and hashes of input/source files. Missing
accepted output scores every field false. `lineItems` is scored as one exact
structured field, not token accuracy. `adjustmentCents` absent/0 is equivalent.
Latency includes rendering, all attempts and cold start. Percentiles use nearest
rank, include failures/outliers, and remove no warmups. Repeated identical fixtures
are not independent samples. All bank payments and controller effects are FAKE.

Retained runs (bad results stay visible):

- `baseline.json`: first prompt; item-prefix loss caused clean false holds.
- `refined.json`: longer prompt fixed the photo, but duplicate descriptions
  absorbed quantity/price lines and the no-PO case failed schema twice. Guarded
  cloud attempts were blocked; nothing was sent to a cloud provider.
- `tuned-before-packaging.json`: final prompt, before worker packaging correction.
- `packaging-verification.json`: bundled-worker correction verified on GX10.
- `receipt.json`: final source/renderer rerun; this is the metrics-generator input.

The low-resolution duplicate may still be held under `NO_PO` rather than the
expected `DUPLICATE_INVOICE` because extracted descriptions contain a numeric
fragment. A safe hold is counted as caught in the trap-hold metric, but does NOT
count as the correct expected rule or exact extraction. Production false holds
and local extraction latency remain limitations; do not present held-as-safe as
correct extraction.

## Reproduce

Unit tests mock model/network calls:

```sh
pnpm --filter @backroom/orchestrator exec vitest run src/router/document.test.ts src/payables/document.test.ts src/metrics/vision.test.ts
pnpm --filter @backroom/web exec vitest run lib/inbox/http.test.ts
pnpm -r build
node orchestrator/scripts/verify-inbox-vision.mjs
```

One opt-in live service script (run on GX10; no credentials needed):

```sh
gx10 gpu
# Sync this branch to a task-isolated directory on GX10; install its lockfile.
gx10 run vision-release 'cd ~/work/backroom-gx10-vision; GX10_VISION_LIVE=1 VISION_REPEATS=3 VISION_SOURCE_SHA=<base-sha> pnpm --filter @backroom/orchestrator vision:live'
gx10 logs vision-release
```

The job host must have Node >=22 and pnpm on PATH. The measured host used the
existing team Node 24.10.0/pnpm runtime (read-only) under the prior benchmark's
`.runtime/`; it was not restarted or modified. `gpu-before.txt` records the GPU
check. Source file hashes identify the uncommitted benchmark snapshot more
precisely than its base git SHA. Fetch `receipt.json` from the isolated job folder.
The script marks incomplete receipts and the metrics reader rejects them.
`pnpm metrics --audit <retained-audit.json> ...` regenerates the additive row
without making network requests or changing previous metric definitions.

Transport formats follow [Ollama vision](https://docs.ollama.com/capabilities/vision)
and [Anthropic image content blocks](https://platform.claude.com/docs/en/build-with-claude/vision).
Renderer API: [PDFium](https://github.com/hyzyla/pdfium).
