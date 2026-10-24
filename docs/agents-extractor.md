# Extractor specialist

`createExtractorSpecialist` in `orchestrator/src/agents/roles/extractor.ts` supplies
the shared Agent SDK runtime with the Haiku prompt, three custom tools and the
allowed next roles (`vendor`, `payables`, `intake`). The shared runtime adds
`handoff` and owns the single top-level query, SDK restrictions, usage accounting
and durable transfer. This module does not run a competing query or dispatcher.

The host injects two private artifact operations:

- `readDocument(ctx, ref)` resolves only this activation's document refs to text
  and optional attachment bytes. The tool also checks the activation allowlist;
  no URLs or filesystem paths are accepted from the model.
- `saveExtraction(ctx, artifact)` persists immutable case evidence and returns a
  registered artifact ref that the shared handoff store can resolve. The adapter
  must check lease/generation atomically at commit. It must not write vendor
  master, invoice payment state, approvals or destinations.

A saved `validated_extraction` has `documentRef`, schema-validated `fields`, and
`bankAccountUsage: 'evidence_only'`. Its account reference is a transcription of
untrusted source material. Downstream roles must parse the artifact, and payment
requests must still reconstruct the destination from the approved vendor master
through `payment-boundary.ts`. A validation result is never vendor verification
or an approval. Intake may receive the original document ref when facts are
missing; downstream invoice processing requires a validated extraction artifact.

`read_document` returns 4000-character chunks (32,000-character maximum).
`local_extract` uses the fixed shared GX10 endpoint, `qwen3:8b` for text and the
existing `renderInvoiceDocument` / `documentMessages` path with `qwen2.5vl:7b`
for images/PDFs. No cloud fallback or Anthropic credential is available to this
local tool. Low confidence returns an Intake escalation. Local attempts and
schema-validation attempts each have an activation-wide limit of three. Calls
are serialized per activation; a repeated successful validation returns the
existing artifact instead of saving a second copy.

Every handler checks current ownership/OFF generation before and after work.
The local HTTP request honors the activation signal; stale results are discarded.
Source content and local-model output remain untrusted data. Schema validation
checks shape, types and invoice totals, not factual truth or vendor identity.

Verification: `pnpm --filter @backroom/orchestrator exec vitest run
src/agents/roles/extractor.test.ts` exercises schema correction/exhaustion,
local text and real image rendering with a mocked provider, scope restrictions,
OFF/cancellation fencing, activation isolation, and evidence-only bank data.
No live SDK/provider call is needed by these tests.
