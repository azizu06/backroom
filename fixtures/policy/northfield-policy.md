# Northfield Studio owner policy

Dana's operating rules for the seeded Northfield Studio company. The sentence
ids are permanent references used by the policy engine and audit wall. Saved
numeric settings live in `policy/src/northfield.json`; the initial limits below
remain historical defaults when Dana saves a new version.

[NF-001] Each seat may use only the actions and rooms assigned to its badge, and no agent may approve an exception or execute a vendor bank change.

[NF-002] Collections may read accounts receivable and manage client collections, Payables may read invoices and purchase orders and pay eligible invoices, and Vendor onboarding may run CRS and Apify checks and propose vendors or bank changes.

[NF-003] Before calling, store consent with its source, exact text, timestamp, and the same phone number that will be dialed.

[NF-004] Call business clients only; consumer clients are email-only.

[NF-005] Call only on weekdays from 9 AM inclusive to 6 PM exclusive in the client's local time.

[NF-006] For the consenting event demo only, a visible and logged demo override may bypass calling hours, but no other safeguard.

[NF-007] Never call a client who has opted out of calls.

[NF-008] An OFAC hit stops the call or payment and sends the case to Dana.

[NF-009] A permanently closed business signal stops collections and sends the case to Dana.

[NF-010] A bankruptcy signal stops calls, offers, and payment links and sends the case to Dana.

[NF-011] A dispute stops calls, offers, and payment links and sends the case to Dana.

[NF-012] A payment plan may not exceed the saved Collections maximum installment count, initially two; ask Dana for an exception.

[NF-013] A payment plan must collect at least the saved Collections minimum first-payment percentage, initially 50 percent; ask Dana for an exception.

[NF-014] A payment plan must finish within the saved Collections maximum duration, initially 30 days; ask Dana for an exception.

[NF-015] Late fees may not be waived unless the saved Collections policy explicitly permits it.

[NF-016] A discount may not exceed the saved Collections maximum discount, initially zero; ask Dana for an exception.

[NF-017] A payment above the saved Payables limit, initially $2,000, requires Dana's approval.

[NF-018] Do not pay an invoice without a matching purchase order; send it to Dana.

[NF-019] A pending or proposed bank change puts payment on hold for Dana to verify through a known contact and approve with a passkey.

[NF-020] A sender domain different from the vendor's known domain by at most two character edits puts the bank change or payment on hold for Dana.

[NF-021] Hold for Dana any invoice with the same vendor and line items as a prior invoice whose total differs by no more than five percent or $100.

[NF-022] Pay only an approved payee in the vendor master; otherwise send the invoice to Dana.

[NF-023] Pay invoices only from the operating account assigned to Payables.

[NF-024] Confirm the client's identity before discussing invoice details, offering amounts, or sending a payment link.

[NF-025] Signals may narrow the saved Collections limits or reorder options, and may never widen authority.

[NF-026] Reject incomplete, malformed, or stale policy inputs rather than treating them as permission.

[NF-027] The first payment link must equal the code-computed first installment of the invoice principal and non-waived late fees after any permitted principal discount.
