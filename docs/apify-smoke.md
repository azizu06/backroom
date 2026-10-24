# T5 Apify smoke test — PASS

Issue: [#6](https://github.com/azizu06/backroom/issues/6). Spec: §8.1 T5 and §4.8. Paid test observed **2026-10-24 07:48:29 UTC** (00:48:29 PDT). Baseline: `6-apify-smoke`, `fbca2dbdd5d88b164cf150cbd89f64c67c206ce6`.

**One Maps place and one Search page succeeded in 16.892 seconds, at $0.01075 combined actual charge.** The company was Kim's Island, Staten Island, New York. Exactly one paid attempt was made per Actor; no paid retry. Final billing was confirmed with read-only run GETs after the workload finished. The measured workload time excludes that later accounting verification.

| Test | Run ID | Provider duration | Actual charge | Result |
| --- | --- | --- | --- | --- |
| Maps `compass/crawler-google-places` | `g2nGZ2liBXaf6zuUy` | 16.321 s | $0.00620 | SUCCEEDED; one place |
| Search `apify/google-search-scraper` | `cbeY9kR5A5W31hAk8` | 4.479 s | $0.00455 | SUCCEEDED; one page, ten organic results |
| Concurrent pair | — | 16.892 s start-to-dataset | $0.01075 | ≤60 s and <$0.10 |

Maps returned `permanentlyClosed=false`, `temporarilyClosed=false`, and `scrapedAt=2026-10-24T07:48:41.492Z`. This proves those typed fields are available for this operating listing; it does not exercise a closed-business stop. The source was [the exact Maps listing](https://www.google.com/maps/search/?api=1&query=Kim%27s%20Island&query_place_id=ChIJJQz5EZzKw4kRCZ95UajbyGw). Search returned the matching [company website](https://kimsislandsi.com/). Opening-hours “Closed” must not be interpreted as permanent closure.

## Limits and account preflight

The ticket's <$0.10 acceptance bar measures actual spend. Both Actors require a minimum configurable ceiling of $0.50; this is not a prepaid charge. The first attempt used self-imposed $0.04 ceilings and was refused. The supervisor corrected that overly narrow interpretation and authorized one measured pair at $0.50/run, maximum $1 combined, inside the team's existing $50 budget.

Before paid starts, authenticated read-only account endpoints confirmed FREE plan $5 included credit and approximately $0.0000506332 monthly usage, leaving more than $1 headroom. The runner also checks headroom before creating runs. It neither changes account settings nor purchases credit.

Maps input uses exactly one documented place ID, `ChIJJQz5EZzKw4kRCZ95UajbyGw`, plus `maxCrawledPlacesPerSearch=1`. The ID came from the official Maps Actor's sample. Direct-place input incurs a mandatory $0.002 detail event even with optional details disabled; this is included in the $0.00620 Maps bill. Search uses one company query with `maxPagesPerQuery=1`. Reviews, images, leads, social enrichment, AI search/overview, ad targeting, and website scraping are disabled. Closed places are not filtered out. Each Actor has `timeout=50`, no restart, and a $0.50 ceiling. The client sends abort requests for active runs at the global 55-second deadline.

## Evidence and cached fallback

- `fixtures/apify/t5-smoke.json`: exact paid inputs, pricing/schema builds, account preflight numbers, timestamps, sanitized outputs, run IDs, and final billing. Use these real cached outputs with the explicit label **cached at 2026-10-24 07:48 UTC** if live service fails.
- `fixtures/apify/t5-maps-started.json` and `t5-search-started.json`: immediate accepted-run receipts, written before polling so an interrupted client preserves the run IDs. These initial receipts are not final billing evidence.
- `fixtures/apify/t5-cap-refusal.json`: the untouched earlier 07:41 UTC refusals for Blue Bottle Coffee, preserved as failure history. Both returned HTTP 400 `max-total-charge-usd-below-minimum`; neither created a paid run.

The API initially returned startup-only combined `usageTotalUsd=$0.00025` despite successful outputs. Fresh read-only GETs confirmed $0.00620 and $0.00455. The evidence preserves both initial and final reports. The runner now checks charged-event counts against run-specific event prices, requires the primary result charge, and waits briefly for billing consistency before PASS. Missing billing stays unknown.

## Local checks and intentional execution

From the repository root, using Node.js 22+:

```powershell
node --test apify/smoke.test.mjs
node --check apify/smoke.mjs
node --check apify/smoke-lib.mjs
```

These commands make no paid calls. `node apify/smoke.mjs` is the paid runner; **do not rerun it for this ticket**. Existing final evidence or accepted-run receipts make it stop before network activity. Preserve all evidence if a future separately authorized test is needed.

The runner reads only `APIFY_TOKEN`, from the process environment or ignored root `.env.local`. Verify `git check-ignore .env.local` before copying credentials. Authentication uses a header, never URL parameters. It stores selected public fields, excluding raw logs, phone numbers, review content, private run URLs, and account identity. Never print or commit environment contents.

Four focused Node tests pass: one-result/$1-ceiling bounds, public evidence selection preserving false closure flags, unknown billing/closure fields, and delayed startup-only billing rejection. Tests preceded implementation; the initial missing-module/export failures and the revised-cap assertion failure were observed before their implementations. No previous smoke tests existed. The generated scaffold's `1+1` example test was not counted.

## TypeScript scaffold and sources

The official `ts-empty` scaffold was created under `apify/client-health-check/` with:

```powershell
npx --yes apify-cli create client-health-check --template ts-empty --skip-dependency-install --skip-git-init
```

`npx --yes apify-cli validate-schema` passed input and dataset schemas. It does not validate the output schema. Dependencies remain uninstalled and scaffold build/runtime validation is pending. This is a skeleton, with no health-check logic or public endpoint; issue #26 implements and publishes it. No Actor was pushed or published here.

Official sources checked before paid starts:

- [Maps input](https://apify.com/compass/crawler-google-places/input-schema) and public default build API: `EH35UvIrsV0hnZG0Y`, number `0.14.775`; [output and place-ID sample](https://apify.com/compass/crawler-google-places).
- [Search input](https://apify.com/apify/google-search-scraper/input-schema) and public default build API: `G3YvRcwtJopIgVcSA`, number `0.0.468`.
- [Maps pricing](https://apify.com/compass/crawler-google-places/pricing), [Search pricing](https://apify.com/apify/google-search-scraper/pricing), and authenticated run billing: FREE base rates $0.004/place and $0.0045/page, plus relevant detail/start events.
- [Run API](https://docs.apify.com/api/v2/actors-runs-post): maximum-charge ceilings, timeout, and build selection.
- [Private user data](https://docs.apify.com/api/v2/users-me-get) and [current limits/usage](https://docs.apify.com/api/v2/users-me-limits-get) for the sanitized headroom preflight.
- [CLI reference](https://docs.apify.com/cli/docs/reference) for scaffold creation and schema validation.

No root manifest/lockfile, shared environment example, policy/state/UI code, or another stream's fixture was changed.
