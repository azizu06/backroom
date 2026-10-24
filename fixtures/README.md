# fixtures/

Northfield Studio seed and proof inputs (spec M2, §4.7, §7). Owner: Tomi
(`@tomiwaaluko`), stream D. `policy/` and `why/` retain their existing contracts.

- `company/northfield.json`: 25 vendors, 82 POs, 83 AP invoices across July,
  August and September 2026, 10 AR invoices and 10 client consent records,
  2 bank-change requests, account placeholders and matched/unmatched credits.
- `company/sources/`: 83 deliberately inconsistent, readable PDF invoices and
  83 email resend threads. The PDFs are actual documents, not renamed text.
- `scenarios/payables.json`: P01-P12 with policy inputs and explicit runtime
  steps. `scenarios/collections.json`: C01-C22 mapped to the original S01-S22
  in spec B §7.1 (source blob SHA is recorded in the answer key).
- `answer-key/expected.json`: expected outcomes, evidence requirements,
  signoff and authorship status. `answer-key/frozen-manifest.json`: SHA-256
  snapshot of data, source documents, scenarios and expected outcomes.

All entities, phone numbers, consents, banks and provider evidence are
**synthetic**. Every client has `dialable: false`; the consent text explicitly
says it is not real consent. These records must never authorize an actual
call. `nessieId` and CRS test identities are null until provisioned by stream C.
The OFAC signal is a synthetic policy input, not a claimed CRS response. Public
company URLs are unset rather than substituting invented Apify evidence.

The JSON is a stable fixture interchange, **not a committed reducer schema**.
It uses §4.7 concepts and `policy/src/types.ts` names: integer cents, percentage
points, `knownDomain`, `pendingBankChange`, `poMatched`, consent
`source/text/timestamp/number`. The stream C importer owns reducer mapping.
`account` uses the policy's logical `operating` / `receivables` account IDs.
Document paths are relative to `fixtures/`. JSON keeps answers out of source
documents; expected outcomes live in scenarios and the answer key.

Trap anchors: #4402 is the original $1,200 Acme invoice; #4419 keeps its exact
items and adds a $37 handling adjustment. #4471 has the lookalike sender
`acme-supp1y.com` versus master `acme-supply.com`. Cedar's #4480 change comes
from the known domain but remains pending human approval. #4481 has no PO,
#4482 is $3,400, #4483 has the synthetic sanctions flag, #4484 lacks a verified
footprint, and #4485 embeds a payment prompt injection. #4401 is P01's $640
normal invoice. AR #1042 is the lead-demo receivable: $4,800 principal
plus a $150 late fee, and C01's full-payment link is $4,950. It also preserves
the existing ask-why haggler reference;
#1043 has an initially unmatched $760 credit with enough evidence to match it.
The $990 ACH credit has no invoice match. C19 plants a $400 payment against a
$500 installment; C20 has two distinct deposits against the same link, requiring
an overpayment/refund task, independently of duplicate-webhook delivery.

Each scenario runs from an isolated snapshot. P02 explicitly resets Acme's
independent pending-bank-change flag so first-failing-rule evaluation can
expose its duplicate trap. P03 checks LOOKALIKE_DOMAIN first, then the pending
bank hold separately. Both rules belong in the full workflow's audit trail.
P04 needs actual verification and a server-verified Dana passkey. `VERIFIED`,
`VENDOR_UNVERIFIED`, `LEASE_EXPIRED` and `ROUTE_FALLBACK` are workflow evidence
labels from the spec; this seed does not invent policy evaluator RuleIds.
Legacy spec-B labels are translated to current policy IDs. C03 checks both the
fee-waiver denial and the separate four-installment escalation. C04's policy
decision escalates a discount request; no unauthorized discount is granted.
C17 is an Apify phone mismatch warning: the consented number is still valid,
so calling may proceed with extra identity caution and a warning to Dana.

Run the offline acceptance check with Python plus `pypdf`:

```powershell
python fixtures/company/validate_seed.py
```

Replay concrete decisions through the **real** policy evaluator (Node 20+):

```powershell
npm exec --yes --package=tsx -- tsx fixtures/company/replay_policy.ts
```

This checks policy outcomes and exact rule IDs and quotes against
`answer-key/expected.json`, not against expectations copied inside the
scenarios. It reports runtime
steps as unexecuted: provider debit/reconciliation, verification/passkey bank
changes, leases, webhook idempotency and routing failover require the app.
Passing fixture validation is not live integration proof.

To regenerate the same seed/PDFs locally, use Python with `reportlab`:

```powershell
python fixtures/company/generate_seed.py
python fixtures/company/validate_seed.py
```

Generation uses fixed inputs/time and invariant PDF metadata, never models or
network calls. It rewrites the answer-key snapshot, so do not run it during a
frozen eval. Review scenario changes, regenerate, validate, then have the owner
sign off the new manifest before running evaluation. **Current signoff is
pending**; a content hash alone does not constitute triumph!'s approval.
Authorship is recorded honestly: 34 team-authored cases, 0 external; the
requested 30% outside contribution target is pending.
