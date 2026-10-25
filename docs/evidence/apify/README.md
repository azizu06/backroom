# Live pre-call Actor evidence

`live-run.json` records **one** website-only run of private Actor
`WQJ4xRGzZN1xj967Z`, build `0.0.3`, through `runCoreDemo({ apify: 'live' })`.
Run **guBODDnPcXO4bX1Ph** succeeded in 1.646 seconds on the platform; the complete
core demo took 2.358 seconds. The receipt includes an authenticated, read-only
platform readback and actual usage of $0.00006043649558226268.

The company is Kim's Island from `fixtures/apify/t5-smoke.json`, with its public
website from that probe. It is explicitly separate from the synthetic AR client
(which has no public-company mapping). The Actor fetched the public site and
returned `website_reachable=true` with source URL and observation time. No Maps
run, closed-status observation, phone-match, or news signal is claimed here.
CRS, the model plan, phone, bank and controller authenticator stayed simulated.
The audit chain passed. The first run's health audit used the demo's fixed clock;
its 0 ms field is a clock artifact, and the receipt labels the independently
measured complete-demo latency. Live health audits now use wall time.

## Reproduce (bills one run)

```sh
PRECALL_APIFY=live pnpm --filter @backroom/orchestrator apify:live
```

This loads `.env.local` and requires `APIFY_TOKEN`. It overwrites the local receipt.
Without the exact switch it skips. The script runs no live model, call or bank
request. It starts the Actor once without retries, pins build `0.0.3`, sends only
company name and website, sets `maxTotalChargeUsd=0.10`, 128 MB, and a 35 second
Actor timeout. The existing pre-call deadline is 40 seconds; errors, invalid
output and incomplete runs become an audited **health check pending**. An HTTP
abort cannot undo a remote run already started; the remote timeout bounds it.
The event-charge cap does not represent a universal cap on compute/storage fees.

For the normal core demo, use `PRECALL_APIFY=live pnpm demo:core` to opt into the
same transport. Default demo and `--record` remain fake. The model-only collections
smoke also accepts the switch, but requires its separate `COLLECTIONS_LIVE=1`.
Successful health audits and core transcripts show `Apify: live run <runId>`;
fake runs show `FAKE`, and unavailable live output shows `Apify: live run pending`.

The transport validates `apify/client-health-check/.actor/dataset_schema.json`'s
`fields` with Ajv, then applies the stricter enum/date/source-URL projection in
`collections/checks.ts`. No raw scrape text reaches the model or audit.
Permanently closed signals still trigger `CLOSED_BUSINESS_STOP` in code.

API contract: [Run Actor](https://docs.apify.com/api/v2/actors-runs-post),
[Get dataset items](https://docs.apify.com/api/v2/dataset-items-get).
Mocked HTTP coverage is in `orchestrator/src/collections/apify.test.ts`.

## Public visibility check, October 25, 2026

The sponsor audit observed an unauthenticated HTTP 200 from the
[Actor metadata API](https://api.apify.com/v2/acts/WQJ4xRGzZN1xj967Z), reporting
`isPublic: true`, `username: azizu` and `name: client-health-check`. The
[public Actor page](https://apify.com/azizu/client-health-check) also returned
HTTP 200 with its quick start and responsible-use README. This later finding
supersedes the earlier private-only visibility status. The API description and
Store summary still described a private build at that check; those words do not
establish current access restrictions.

This was a read-only listing check, not a new Actor run, publication or Maps
scrape. The build, cost, inputs and simulated components of the historical run
above remain unchanged. See the [Actor source README](../../../apify/client-health-check/README.md)
for reuse under both Best Use and Best Actor.
