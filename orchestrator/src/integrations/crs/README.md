# CRS sandbox boundary (M3 / M8, Refs #4)

Server-only entry point: `orchestrator/src/integrations/crs/index.ts`.

```text
approved test identity ID → CrsClient → CRS sandbox → typed summary + SHA-256
```

`login(): Promise<void>` caches authentication without returning tokens.
`getBusinessCreditReport(testIdentityId)` and `checkOfac(testIdentityId)` return
`CrsEvidence`: source `crs_sandbox`, product, testIdentityId, literal-format
`SANDBOX: test identity #N` label, checkedAt, responseHash, and summary.
The hash covers `JSON.stringify` of the parsed response, not original wire bytes.
No raw response, request identity, request ID, provider message, or token is returned.
There is no persistence in this client. Store **only CrsEvidence** in state/audit;
do not store the private request bodies or provider responses.

OFAC summary is `hit | clear | unknown`; unrecognized output becomes `unknown`.
Consumers must hold/escalate `unknown` and block/escalate `hit`; this client does
not grant approval or make policy decisions. Business credit currently exposes
only an optional numeric score. A missing score is not evidence of good credit.

## What is verified, and what remains unavailable

Checked 2026-10-24 against first-party sources:

- [Cal Hacks event page](https://calhacks.crscreditapi.com/): sandbox base
  `https://api-sandbox.stitchcredit.com/api`; POST `/users/login` with username
  and password. Product-specific Postman collections arrive in a separate email.
- [Current OpenAPI](https://www.crscreditapidocumentation.com/openapi.json):
  UserLoginRespDTO has `token`, `refreshToken`, `expires`; POST
  `/users/refresh-token` takes `{refreshToken}` and returns UserLoginRespDTO.
  The client refreshes on 401 rather than guessing the units of `expires`.
- [Official Cal Hacks developer package](https://www.npmjs.com/package/@crscreditapi/crs-calhacks-mcp-server)
  version 1.1.2: reuse login tokens, avoid refresh immediately after login
  (`CRS117`), stop repeated failed login attempts, and inspect HTTP-200
  `errorMessages`. **An input that does not exactly match a sandbox persona can
  reach a real vendor**, even on the sandbox host.
- [Business credit catalog](https://crscreditapi.redoc.ly/developer-portal/business-credit/)
  describes business products, but its linked routes are absent from the current
  downloadable OpenAPI. The event package lists no business-credit or standalone
  OFAC product. Consumer credit is not substituted for business credit.

Consequently **no business/OFAC endpoint, response parser, or test identity is
invented or enabled by default**. Missing adapters/identities fail before login.
This is a tested transport/evidence boundary, not a completed live T3 integration.
Auth mocks follow the published schema; product mocks are explicitly synthetic
adapter contracts, **not recorded vendor examples**. Replace those with redacted
Postman-shaped examples when supplied. `docs/spec-b.md` was absent at implementation;
`docs/spec.md` §§1.4, M3, M8, 4.10, 8.1 provide the product requirements.

Needed from the CRS email or booth, exactly:

1. Sandbox username and password (and account activation confirmation).
2. The account-specific Postman collection/OpenAPI and enabled configuration IDs
   for business credit and standalone OFAC, including method/path, required request
   fields, successful and error response examples, and authoritative OFAC match semantics.
3. Exact **approved business sandbox test request bodies**, their identity IDs,
   and permission to map them to Northfield's clients/vendors. A personal guarantor
   substitute requires explicit sponsor/product confirmation.
4. An approved OFAC-hit test identity and a clear identity, with expected outcomes;
   confirmation that these products return canned data rather than calling a live vendor.

## Configure after sponsor confirmation

Pass `identities: CrsSandboxIdentity[]` and `products: {businessCredit, ofac}` to
`new CrsClient({username, password, identities, products})`. Each identity contains
its sponsor test ID, a provenance `source`, and exact approved request bodies for
the two products. Each trusted server adapter contains a confirmed relative `path`
and `summarize(body)` parser returning only numeric `creditScore` or enum
`ofacStatus`. Parsers must recognize the documented successful response and
business errors before reporting clear/credit values. Client output is projected
again to prevent extra fields escaping. These adapters are trusted code, never
LLM/tool/browser input. Arbitrary URLs and redirects are refused.

`fixtures/crs/northfield-mapping.json` reserves two local identity slots only.
Its null testIdentityIds deliberately prevent treating placeholders as approved
sandbox identities. Reconcile its Northfield references with the seed fixture
owner before wiring it into a worker.

Use a gitignored local `.mjs` module exporting `identities` and `products`, with
those confirmed adapters and request bodies. Keep it server-side. Then export
`CRS_USERNAME`, `CRS_PASSWORD`, `CRS_LIVE=1`, `CRS_SANDBOX_MODULE` (absolute module
path), and `CRS_TEST_ID` before running:

```sh
pnpm --filter @backroom/orchestrator crs:live
```

The probe runs one business report then one OFAC check on that approved test ID,
printing only their evidence. It skips when opt-in, credentials or module are
missing; configured failures exit nonzero with sanitized errors. A completed
probe is required to claim the two live 200s; mocks do not satisfy T3.

Tests: `pnpm --filter @backroom/orchestrator test` (network mocked).
