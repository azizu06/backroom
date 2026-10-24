# False-hold diagnosis after #81 (Refs #29)

Baseline full receipt: [3353505](https://github.com/azizu06/backrooms/blob/3353505/docs/evidence/inbox-benchmark/receipt.json).
It is retained in Git, including all original inputs, calls and audit chains.

- **P04 after approval:** the baseline chain contains the bound passkey decision
  and `bank_change_approved`, then a new `bank_change` classification on the
  invoice resend and another `vendor_verified` escalation. The proposed account
  already equals the applied master. VendorSeat now treats that exact current
  account as already applied only with matching envelope/field/master domains,
  an approved nonsanctioned master and no pending change. No master write,
  payment or new approval is created. A different account still follows the
  verification and passkey workflow. The public raw-inbox regression reproduces
  the bank-change classification and requires `approved`, with zero payments.
- **P01 OFF:** the baseline had no extraction fallback, even though its explicit
  attachment transcription contains every required field. A narrow deterministic
  parser now accepts one complete structured transcription and runs the ordinary
  schema and PayablesSeat. It also recovers this same explicit data after a model
  outage/unrecognized result. Missing/invalid/conflicting blocks still hold.
  Tests cover all Northfield policy gates under OFF and a failed model route;
  all seven traps stay held without any policy edits.
- **RT-241/242:** their original “valid” messages omitted stable vendor ID, bank
  account reference and line items. They also claimed POs/vendors not in the
  seeded master. Holding them was correct validation behavior. Only these two
  controls were corrected to complete synthetic Acme invoices against existing
  PO-5000 ($314); the original texts remain in each row's `correction` metadata.
  The original generation attribution applies to `originalText`. No trap text,
  label, master, PO or policy was changed. Cases remain independent with fresh
  state; two invoices against that PO are not run as a shared-state batch.

## The original 24 failed routes

All 24 were red-team `field_extraction` tasks. Across the full baseline there
were 96 HTTP attempts: **94 HTTP 200, zero HTTP error statuses, two transport
failures**. RT-211 and RT-281 hit transport failures at 8002.66 and 8002.05 ms,
consistent with the default 8-second timeout. The original wrapper erased the
exception name, so these are timeout-shaped observations, not proven timeout
exceptions. The other **22 failed tasks received HTTP 200** for their attempts.
The baseline does not retain response content or decoder failure categories:
it cannot establish how many were schema versus envelope versus confidence
failures. We do not invent a breakdown from HTTP status.

The router now emits redacted `onFailure` observations for timeout, transport,
HTTP status, envelope/JSON, task schema and confidence failures. It rejects extra
envelope keys as well as invalid task fields. Schema retries receive their prior
failure category; after two invalid local outputs the original cloud escalation
still applies. Broken transport and low confidence still escalate immediately;
the 8-second local timeout and 5-second p50 circuit remain unchanged.

The classifier now knows which factual fields extraction requires and can return
`unknown` for sparse text instead of attempting to invent missing schema fields.
That is a successful classification followed by an INVALID_INPUT safety hold,
not a successful invoice extraction or intended-rule detection. The rerun keeps
that distinction in every case and in its expected-rule table. Cloud fallback
transport observations in this benchmark are the explicit guard blocking an
external request; they are not HTTP failures or spend.

Local provider-constrained full-schema decoding was probed and discarded after
it slowed valid requests into the existing circuit/timeout gates. The final
router keeps JSON-object mode, strict application validation and gpt-oss low
reasoning. No timeout or policy threshold was raised to improve the numbers.
