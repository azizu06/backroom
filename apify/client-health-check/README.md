# Client Health Check

Check one business website and turn existing public listing observations into small, sourced JSON signals. Built for Backroom at Cal Hacks 13.0, this Actor helps B2B operations teams and developers review client or vendor information before a human makes a decision.

It makes one HTTP GET to the supplied website (following redirects), compares supplied phone numbers, and normalizes supplied Maps closure flags. It returns structured facts with source URLs and timestamps, without returning page text or calling a language model.

## Quick start

1. Enter a business name and its public website.
2. Optionally supply an already collected Maps observation and two phone numbers to compare.
3. Run the Actor and open the default dataset, or export it as JSON/CSV.

Minimal input using the demo's real public company:

```json
{
  "companyName": "Kim's Island",
  "website": "https://kimsislandsi.com/"
}
```

Full input example (the Maps observation below is historical, not a fresh lookup; phone numbers are illustrative):

```json
{
  "companyName": "Kim's Island",
  "website": "https://kimsislandsi.com/",
  "phone": "(718) 555-0100",
  "listedPhone": "7185550100",
  "maps": {
    "permanentlyClosed": false,
    "temporarilyClosed": false,
    "sourceUrl": "https://www.google.com/maps/search/?api=1&query=Kim%27s%20Island&query_place_id=ChIJJQz5EZzKw4kRCZ95UajbyGw",
    "observedAt": "2026-10-24T07:48:41.492Z"
  }
}
```

| Input | Meaning |
| --- | --- |
| `companyName` | Required business name; context only, never sent to a model. |
| `website` | Optional public HTTP(S) URL to probe, maximum 2,000 characters. |
| `phone`, `listedPhone` | Optional business phone numbers. Both are needed for comparison. |
| `maps` | Optional existing observation: closure booleans, HTTP(S) `sourceUrl`, and parseable `observedAt`. |

## Output

Each run writes one dataset item containing a `signals` array. For example:

```json
{
  "signals": [
    {
      "type": "website_reachable",
      "value": true,
      "sourceUrl": "https://kimsislandsi.com/",
      "observedAt": "2026-10-24T12:00:00.000Z"
    }
  ]
}
```

The example timestamp is illustrative. Every signal has `type`, `value`, `sourceUrl`, and `observedAt`.

| Signal | Values and interpretation |
| --- | --- |
| `website_reachable` | Boolean: HTTP 200–399 is `true`; other returned statuses are `false`. Uses the supplied URL and this run's observation time. Network failures, timeouts, or invalid URLs omit the signal. |
| `maps_status` | `permanently_closed`, `temporarily_closed`, `operating`, or `unknown`. Permanent closure takes priority; `operating` requires both flags explicitly `false`. Requires a source URL and timestamp, which are preserved from the supplied observation. |
| `phone_match` | Boolean equality after removing all non-digits; requires both nonempty digit strings and a valid Maps or website source URL. Country codes are not normalized. Uses this run's timestamp. |

Missing evidence produces omitted signals, potentially `{"signals":[]}`; it does not mean a business is healthy. The signal library also supports explicit sourced `distress_news` observations, but news collection and a news input field are not provided by this Store Actor.

## Limits and responsible use

- One company and at most one initial website request per run; redirects may make additional requests. The probe has a 10-second timeout. There is no browser rendering, link crawling, retry loop, or page-content analysis.
- **No Maps bulk runs:** this Actor does not invoke Google Maps, Search, or any other Actor. Collect permitted listing observations separately and retain their original timestamps. A company name alone does not trigger discovery.
- Website reachability is not proof of identity, solvency, legitimacy, or continued operation. Bot blocks and HTTP errors can produce negative signals; timeouts produce no website signal.
- Supplied Maps and phone data are not independently verified. An old observation stays old. Opening-hours “closed” must not be treated as permanent closure.
- Use public business URLs and business contact information you are authorized to process. Inputs and results are stored in your Apify run storage. Do not submit credentials, private endpoints, or personal/sensitive data.
- This Actor makes no calls, sends no messages, approves no vendors or payments, and provides no credit score. Keep consequential decisions and consent checks in your application and human review workflow.

## Cost

The Actor is free to use with **no rental, per-result, or per-event developer fee**. Apify platform compute, storage, and data-transfer usage may still consume account credits or incur charges under your plan; see [Apify pricing](https://apify.com/pricing). It starts no paid third-party Actors and uses no paid proxy or model API. Start with 256 MB memory and a 30-second run timeout for this single-site check; actual usage depends on the website and platform startup time.

## Development

Source: [Backroom](https://github.com/azizu06/backrooms/tree/main/apify/client-health-check). From this directory, run `npm install`, `npm run build`, and `npm test`. The entry-point test mocks the Apify SDK and network. Existing signal-contract checks run with `node --experimental-strip-types --test src/signals.test.ts`. See the repository's `apify/smoke.mjs` for the separate, opt-in provider smoke test; it is not part of this Actor's normal run.
