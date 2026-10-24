import { afterEach, describe, expect, it } from 'vitest';
import { GET as precallRoute } from '../../app/api/calls/precall/route';
import { installPrecallEvidence, precallCard, precallRows, type PrecallSignal } from './precall';

const MAPS_URL = 'https://www.google.com/maps/place/?q=place_id:abc';
const row = (type: string, value: unknown, label: string, extra: Partial<PrecallSignal> = {}): PrecallSignal =>
  ({ source: 'apify', type, value, observedAt: '2026-10-24T18:05:09.000Z', label, sourceUrl: MAPS_URL, ...extra });

afterEach(() => installPrecallEvidence(undefined));

describe('desk phone pre-call card', () => {
  it('shows a live Apify run as open with its run id, host, time and phone match', () => {
    const label = 'Apify: live run run_AbC123';
    const card = precallCard({ preCall: { status: 'ready' }, signals: [row('apify_maps_status', 'operating', label), row('apify_phone_match', true, label)] });
    expect(card).toEqual({ business: 'open', businessDetail: 'Operating', source: label, sourceHost: 'www.google.com',
      checkedAt: '18:05 UTC', phoneMatch: 'yes', status: 'ready', warnings: [] });
    expect(precallRows(card)).toEqual([
      { label: 'Business', value: 'Open · Operating' },
      { label: 'Source', value: 'Apify: live run run_AbC123 · www.google.com' },
      { label: 'Checked', value: '18:05 UTC' },
      { label: 'Phone match', value: 'yes' },
      { label: 'Pre-call', value: 'ready' },
    ]);
  });

  it('keeps FAKE and cached labels verbatim, never upgrading them to live', () => {
    expect(precallCard({ preCall: { status: 'ready' }, signals: [row('apify_maps_status', 'operating', 'FAKE')] }).source).toBe('FAKE');
    const cached = precallCard({ preCall: { status: 'ready' }, signals: [row('apify_maps_status', 'operating', 'Apify: run run_X (cached at 17:00 UTC)'), row('apify_phone_match', false, 'Apify: run run_X (cached at 17:00 UTC)')] });
    expect(cached).toMatchObject({ source: 'Apify: run run_X (cached at 17:00 UTC)', phoneMatch: 'no' });
    expect(precallRows(cached).map(r => r.value).join(' ')).not.toMatch(/live run/);
  });

  it('shows a closed business with the blocked pre-call and its reason', () => {
    const card = precallCard({ preCall: { status: 'blocked', reason: 'Business permanently closed' },
      signals: [row('apify_maps_status', 'permanently_closed', 'Apify: live run run_Z')] });
    expect(card).toMatchObject({ business: 'closed', businessDetail: 'Permanently closed', status: 'blocked', reason: 'Business permanently closed', phoneMatch: 'unknown' });
    expect(precallRows(card)).toContainEqual({ label: 'Pre-call', value: 'blocked · Business permanently closed' });
    expect(precallRows(card)[0]).toEqual({ label: 'Business', value: 'Closed · Permanently closed' });
  });

  it('reads unknown, never open, without evidence', () => {
    for (const evidence of [null, {}, { preCall: { status: 'not_prepared' }, signals: [] }]) {
      expect(precallCard(evidence)).toEqual({ business: 'unknown', businessDetail: 'Not checked', source: 'No Apify evidence recorded',
        phoneMatch: 'unknown', status: 'not prepared', warnings: [] });
    }
    const odd = precallCard({ preCall: { status: 'ready' }, signals: [row('apify_maps_status', 'unknown', 'FAKE', { sourceUrl: 'not a url' }),
      { ...row('crs_bankruptcies', 0, 'FAKE: CRS fixture'), source: 'crs_fixture' }] });
    expect(odd).toEqual({ business: 'unknown', businessDetail: 'Status unknown', source: 'FAKE', checkedAt: '18:05 UTC', phoneMatch: 'unknown', status: 'ready', warnings: [] });
  });

  it('passes pre-call warnings through when the host publishes them', () => {
    const card = precallCard({ preCall: { status: 'ready', warnings: ['PHONE_MISMATCH_WARN', 7] }, signals: [row('apify_phone_match', false, 'Apify: live run run_Q')] });
    expect(card.warnings).toEqual(['PHONE_MISMATCH_WARN']);
    expect(precallRows(card).at(-1)).toEqual({ label: 'Warning', value: 'PHONE_MISMATCH_WARN' });
  });

  it('serves the card read-only from the host evidence, no-store', async () => {
    let response = await precallRoute();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json()).card).toMatchObject({ business: 'unknown', status: 'not prepared' });
    installPrecallEvidence(() => ({ preCall: { status: 'ready' }, signals: [row('apify_maps_status', 'operating', 'Apify: live run run_R')] }));
    response = await precallRoute();
    expect((await response.json()).card).toMatchObject({ business: 'open', source: 'Apify: live run run_R', sourceHost: 'www.google.com' });
    installPrecallEvidence(() => { throw new Error('host down'); });
    response = await precallRoute();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'PRECALL_UNAVAILABLE' });
  });
});
