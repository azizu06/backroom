# Judge inbox tray (#22 / #30)

Open `/inbox` without the 3D office. `web/components/InboxTray.tsx` is also a
mountable DOM panel for the lobby's `inboxTray` prop. Pass `inboxPresets` from
`web/lib/inbox/presets.ts` through a server component to include the frozen traps.
No secret or server capability is passed to the browser.

```text
judge text → POST /api/inbox → processInbox → exported router + strict schemas
                                           → PayablesSeat / VendorSeat
                                           → decision + pending escalation
                                           → shared StateStore audit → /audit
unchanged preset → frozen typed fields → same seats and code policy
PDF/image → fingerprint → ESCALATE (no OCR or file retention)
```

## Request and receipt

`POST /api/inbox` accepts same-origin multipart form data: `kind` (`email` or
`invoice`), `text` (at most 32,000 characters), `senderDomain`, optional
`presetId`, and optional `attachment` (PDF, PNG, JPEG, WebP; at most 4 MB).
The server forces `source: judge`; request fields cannot supply authority,
policy context, verification evidence, or an approval. Sender domain is explicitly
judge-entered **demo** metadata, not an authenticated real email envelope.
Only synthetic scenarios should be entered.

An unchanged preset is identified by matching its ID, document type, sender and
full text with the server copy. Multipart CRLF normalization is handled. Any
edit returns to the normal schema-validated model intake. The receipt clearly
labels seed fields versus model-extracted fields; it never invents a local model
call for a preset. Presets derive from the frozen Northfield adapter; P02 uses
its documented isolated duplicate precondition (clearing the independent pending
Acme bank-change flag in this submission's private fixture repository). No seed
file or live master is changed.

The response includes the routed seat, validated fields or null, the original
`SeatResult` (decision, quoted policy sentence, rule IDs, status and escalation),
`scenario_source: judge`, and a link to the exact `judge_inbox_decision` audit
receipt. The private wall still requires its existing operator read session.
The receipt audits text, fields and attachment metadata in the shared
`getStateStore()`; it creates no independent audit store.

## Deliberate integration limits

The finance repository is an isolated synthetic Northfield snapshot per
submission. No debit-capable Nessie adapter or live CRS/Apify checks are installed
by this public demo form. Clean invoices therefore stay held, and Cedar remains
held for missing verification. The tray cannot approve, apply a bank change or
claim a successful payment. Controller passkeys and the private gateway remain
the authority for those actions. Bind live capabilities only through a trusted
server adapter; never accept them from form data.

All uploads are conservatively escalated, including text accompanied by an
upload. The audit retains filename, MIME type, byte length and SHA-256 only;
file contents are neither parsed nor retained. The UI says this before and after
submission. Paste relevant text without the attachment to exercise extraction.
This is a review handoff, not a claim of working OCR or stored evidence retrieval.

Unrecognized input, missing sender, schema failure, provider errors (including
OpenRouter 402), and LLM OFF produce visible ESCALATE with a pending review record.
Extraction uses exported `route()` through `processInbox`; no direct model API is
introduced. The existing `orchestrator/src/payables/live.ts` is the opt-in model
smoke; no live sponsor calls were needed for tray validation.

## Verification

- `pnpm --filter @backroom/web exec vitest run lib/inbox/http.test.ts`
- `pnpm --filter @backroom/web build`
- `pnpm --filter @backroom/web test:inbox:browser`

HTTP tests inject model/network boundaries and use the real schemas, seats,
policy, escalation and audit APIs. The headless test uses real Next routes with
models disabled, tests the planted lookalike trap, original charity-account
instructions, a PDF hold, the private audit wall, focus, phone width and an
unobscured submit button. It records:

- [Laptop trap receipt](evidence/inbox/desktop-trap.png)
- [Phone judge scenario](evidence/inbox/mobile-scenario.png)
- [Phone upload hold](evidence/inbox/mobile-upload.png)

No outside-user drill, live extraction, real debit or physical passkey evidence is
claimed by these tests. Refs #22, #30; the broader scenario drill remains open.
