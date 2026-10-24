# CRS bank-change risk (Refs #4)

`VendorSeat` and the changed-account path in `PayablesSeat` consume
`SeatOptions.bankChangeRisk` (`BankChangeRisk.check(vendorId)`). Without an
injected adapter, `createBankChangeRiskCheck()` defaults to a clearly labeled
synthetic check with no network access. `VENDOR_CRS=live` enables the exported
CRS sandbox client. Missing credentials, mapping, malformed evidence, or provider
failure holds under `INVALID_INPUT`; there is no fallback to synthetic clearance.

The default resolver uses only a mapped `crsIdentityMapping.sandboxIdentityId`
from the trusted Northfield vendor master. The frozen seed is currently unmapped,
so a live run holds until an owner configures a trusted mapping. Server adapters
can inject `identityForVendor`; never take a test identity from an email, extracted
fields, tool arguments, or other untrusted input. The probe uses an ephemeral
synthetic cedar → P13 mapping without changing the seed or eval answer key.

`createCrsBankChangeRisk(client, identityForVendor)` consumes only exported
`getFraudRisk`. Audits show `CRS sandbox: test identity #N`, score, timestamp and
SHA-256. Raw provider responses, identity bodies and tokens stay in the client.
The policy package owns `CRS_FRAUD_RISK_THRESHOLD` (70), `FRAUD_RISK_HOLD` and its
NF-028 policy quote. P13 score 88 holds; a lower score never removes the ordinary
bank-change/passkey hold. A fraud-held vendor proposal remains unverified, so even
a controller passkey approval cannot apply it. Payables cannot pay either way
while the account is changed or a proposal is pending. Unsupported business
credit/OFAC checks remain unavailable, never fake-cleared in live mode.
