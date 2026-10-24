# Vendor verifier role

One responsibility: gather trusted evidence about the vendor behind a case and decide whether Payables can proceed.
Allowed next: `payables`, `extractor`; a `human_review` verdict ends with no handoff (the dispatcher returns `held`).

Tools (`createVendorTools`): `get_vendor_master`, `check_domain {which}`, `check_business`, `apify_site_check`,
`apify_contact_page`, `conclude_verification {outcome, note}`. Identity, vendor, domains, account and thresholds come from
`deps.loadCase(activation)` and the master, never from model args. Tools only read; the master is never written.

- **Verdict is code-checked.** `assess()` computes the allowed outcomes from the evidence ledger. Stop rules
  (`BANKRUPTCY_STOP`, `OFAC_STOP`, `FRAUD_RISK_HOLD` at CRS score >= 70, `LOOKALIKE_DOMAIN`, `PAYEE_NOT_IN_MASTER`), any bank
  change or account difference, a non-exact domain, or CRS that did not answer allow only `human_review`
  (`return_to_extractor` only for a mis-extracted payee/domain). The verdict seals after the first ALLOW. A legitimate bank
  change still needs Dana's passkey; `proceed` is never offered for one.
- **Handoff gate.** `assertVendorHandoff(store, request)` for the HandoffStore: payables needs a `proceed` verdict ref,
  extractor a `return_to_extractor` ref, and nothing else leaves the role.
- **Apify.** Team Actor `client-health-check` (website reachable) plus Store `vdrmota/contact-info-scraper`
  (`9Sk4JJhEma9vBKqrg`, max 3 pages of the vendor's own site, ~$0.001 per run; Apify enforces a $0.50 minimum
  `maxTotalChargeUsd`). `ApifyBudget` reserves the cap before each run (2 runs/case, $5/demo by default) and settles to
  reported usage. A timeout is `pending`, a failure `unavailable`, an exhausted budget `skipped_budget`: none is evidence and the
  verdict lists them under `pending`. Scraped text is reduced to email domains and phone tails.
- **Model.** `chooseVendorModel` picks Sonnet for bank changes, sender/claimed/account mismatches and pending changes,
  otherwise Haiku. `createVendorSpecialist(deps, model)` builds the `Specialist`.
- **Opt-in live Apify smoke:** `VENDOR_APIFY=live pnpm --filter @backroom/orchestrator exec tsx src/agents/tools/vendor-apify-live.ts [url]`.
