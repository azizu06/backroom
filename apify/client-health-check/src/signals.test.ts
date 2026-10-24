import assert from 'node:assert/strict';
import test from 'node:test';
import { healthResult, probeWebsite } from './signals.ts';

const observedAt = '2026-10-24T07:48:41.492Z';
const maps = { permanentlyClosed: false, temporarilyClosed: false, sourceUrl: 'https://maps.example/place', observedAt };

test('operating listing, reachable site, and matching phone become typed signals', () => {
  const result = healthResult({
    companyName: "Kim's Island", website: 'https://kimsislandsi.com/', phone: '(718) 555-0100',
    listedPhone: '7185550100', websiteStatus: 200, maps, observedAt,
  });
  assert.deepEqual(result.signals.map(signal => [signal.type, signal.value]), [
    ['maps_status', 'operating'],
    ['website_reachable', true],
    ['phone_match', true],
  ]);
  assert.equal(JSON.stringify(result).includes('scraped'), false);
});

test('permanent closure wins over a temporary flag and a phone mismatch stays false', () => {
  const result = healthResult({
    website: 'https://example.com/closed', phone: '7185550100', listedPhone: '7185550199',
    websiteStatus: 404, maps: { ...maps, permanentlyClosed: true, temporarilyClosed: true }, observedAt,
  });
  assert.equal(result.signals.find(signal => signal.type === 'maps_status')?.value, 'permanently_closed');
  assert.equal(result.signals.find(signal => signal.type === 'website_reachable')?.value, false);
  assert.equal(result.signals.find(signal => signal.type === 'phone_match')?.value, false);
});

test('distress is emitted only from an explicit sourced boolean', () => {
  assert.equal(healthResult({ companyName: 'bankruptcy rumors in the page text', observedAt }).signals.length, 0);
  const result = healthResult({
    observedAt, distress: { value: true, sourceUrl: 'https://news.example/story', observedAt },
  });
  assert.deepEqual(result.signals, [{ type: 'distress_news', value: true, sourceUrl: 'https://news.example/story', observedAt }]);
});

test('website probe returns the status and does not throw when the request fails', async () => {
  assert.equal(await probeWebsite('https://example.com', async () => new Response(null, { status: 204 })), 204);
  assert.equal(await probeWebsite('https://example.com', async () => { throw new Error('offline'); }), undefined);
  assert.equal(await probeWebsite('not a url', async () => new Response()), undefined);
});
