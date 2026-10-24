import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cases, runOptions, summarizeRun, publicItems, billingComplete } from './smoke-lib.mjs';

test('the two one-result test runs retain the authorized one-dollar maximum ceiling', () => {
  assert.equal(cases.length, 2);
  assert.equal(cases.length * Number(runOptions.maxTotalChargeUsd), 1);
  assert.equal(runOptions.timeout, '50');
  assert.equal(runOptions.restartOnError, 'false');
  assert.equal(cases[0].input.maxCrawledPlacesPerSearch, 1);
  assert.equal(cases[0].input.placeIds.length, 1);
  assert.ok(!Object.hasOwn(cases[0].input, 'searchStringsArray'));
  assert.equal(cases[0].input.skipClosedPlaces, false);
  assert.equal(cases[0].input.maxReviews, 0);
  assert.equal(cases[0].input.maximumLeadsEnrichmentRecords, 0);
  assert.equal(cases[1].input.maxPagesPerQuery, 1);
  assert.equal(cases[1].input.aiModeSearch.enableAiMode, false);
});

test('evidence excludes private run metadata and preserves false closure flags', () => {
  const result = summarizeRun({ id: 'run1', status: 'SUCCEEDED', startedAt: '2026-10-24T00:00:00Z', finishedAt: '2026-10-24T00:00:02Z', usageTotalUsd: 0.004, token: 'secret', containerUrl: 'private', meta: { clientIp: 'private' } });
  assert.equal(result.durationSecs, 2);
  assert.equal(result.costUsd, 0.004);
  assert.ok(!JSON.stringify(result).includes('private'));
  assert.ok(!JSON.stringify(result).includes('secret'));
  const items = publicItems('maps', [{ title: 'Business', permanentlyClosed: false, temporarilyClosed: false, phone: 'private', reviews: ['private'], url: 'https://maps.google.com/place' }]);
  assert.equal(items[0].permanentlyClosed, false);
  assert.ok(!JSON.stringify(items).includes('private'));
});

test('missing billing and closure data stays unknown', () => {
  assert.equal(summarizeRun({ id: 'r', status: 'RUNNING' }).costUsd, null);
  assert.equal(summarizeRun({ id: 'r', status: 'RUNNING' }).durationSecs, null);
  assert.ok(!Object.hasOwn(publicItems('maps', [{}])[0], 'permanentlyClosed'));
});

test('startup-only billing cannot finalize a successful scraped page', () => {
  const run = { usageTotalUsd: 0.00005, chargedEventCounts: { 'search-page-scraped': 1, 'apify-actor-start': 1 }, pricingInfo: { pricingPerEvent: { actorChargeEvents: { 'search-page-scraped': { eventPriceUsd: 0.0045 }, 'apify-actor-start': { eventPriceUsd: 0.00005 } } } } };
  assert.equal(billingComplete(run, 'search-page-scraped'), false);
  assert.equal(billingComplete({ ...run, usageTotalUsd: 0.00455 }, 'search-page-scraped'), true);
  assert.equal(billingComplete({ ...run, chargedEventCounts: { 'apify-actor-start': 1 } }, 'search-page-scraped'), false);
});
