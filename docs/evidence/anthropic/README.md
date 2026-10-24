# Direct Anthropic router smoke — 2026-10-24

Refs #27. Anthropic is the primary cloud provider; OpenRouter is retained only
as an explicit opt-in. These are real, first-party Anthropic API calls with synthetic fixture
inputs. No phone call, bank operation, approval, or durable state write ran.
Credentials came from the local macOS Keychain into gitignored `.env.local`;
no credential was copied to GX10 or included in these receipts.

The successful receipt is [live-2026-10-24T09-49-44-622Z.json](live-2026-10-24T09-49-44-622Z.json).
Both calls returned HTTP 200 from `https://api.anthropic.com/v1/messages`,
`model=claude-sonnet-5-5`, `route=cloud`:

| Task | Input tokens | Output tokens | Latency | Cost USD |
| --- | ---: | ---: | ---: | ---: |
| Call plan | 343 | 673 | 6561 ms | 0.007416 |
| Ask why invoice #4419 was held | 892 | 185 | 1961 ms | 0.003634 |

The call plan passed its schema and describes AI disclosure and identity before
amount. This is a generated plan, not proof of live call enforcement. Ask-why
returned `source=model`, cited the expected entries 212 and 213 inline, and
passed the existing citation validator on its first attempt.

Successful run: **$0.011050**. An earlier implementation error after the first
response spent **$0.007056**, preserved in
[live-2026-10-24T09-49-22-179Z.json](live-2026-10-24T09-49-22-179Z.json).
The cost-normalization bug was fixed before rerunning. **Total task spend:
$0.018106 of the authorized $3 cap.** No cached tokens were charged in these runs.

Run from the repository root:

```sh
ROUTER_LIVE_ANTHROPIC=1 pnpm --filter @backroom/orchestrator exec tsx src/router/anthropic-live.ts
```

The script loads `.env.local` through the existing server runtime, pins Sonnet
5.5, disables GX10 for this smoke, permits only the Anthropic Messages endpoint,
and limits itself to three requests (one plan plus ask-why's existing single
correction retry). With 4096 output tokens and <100 KB request bodies, each call
reserves $0.25 conservatively; the run reserves at most $0.75. It records returned
usage even if later schema/citation validation fails. Each invocation writes a
new receipt, including failed runs. Repeated invocations incur additional spend.

Official references checked for this implementation:

- [Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Sonnet 5.5 model](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)
- [Sonnet 5.5 migration parameters](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide)
- [First-party pricing](https://platform.claude.com/docs/en/about-claude/pricing)

Token charges use the published standard rates: Sonnet 5.5 $2/$10 per million
input/output tokens. This is usage-based cost, not a billing-console receipt or
remaining-credit balance. The transport also prices opt-in Haiku 5.5 with its
100,000-token context tier and both models' cache read/write categories. Unknown
model overrides fail before a request rather than inventing a price.

Offline verification: `ANTHROPIC_API_KEY='' pnpm -r test` passed all 518 tests
(313 orchestrator); `ANTHROPIC_API_KEY='' pnpm -r build` passed all packages.
Network mocked in unit tests, including direct-provider priority, two-failure
extraction escalation, GX10 outage, token/cache pricing, malformed usage,
truncation/refusal, OFF fencing, and Anthropic-only ask-why.

## Rebase verification (2026-10-24, main cec603e)

Preserved the strict two-key envelope, schema checks, retry correction guidance,
and redacted failure categories introduced by the inbox false-hold work. The
Anthropic transport now uses those same categories, with seven additional mocked
regressions covering HTTP/envelope/schema/confidence/timeout/transport diagnostics.
`ANTHROPIC_API_KEY='' pnpm -r test` passed 594 tests (343 orchestrator), and
`ANTHROPIC_API_KEY='' pnpm -r typecheck` passed every package. No additional live
requests or credit spend were needed for the rebase.

The review's suggested $0.20/M Sonnet 5.5 cache-read price was checked against
the official Sonnet 5.5 model page linked above, which lists $0.10/M. The existing
rate and mixed-cache test expectation are therefore retained.
