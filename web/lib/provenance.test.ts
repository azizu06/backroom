import { describe, expect, it } from 'vitest';
import { crsFraudText, displayProvenance } from './provenance';

describe('evidence label display', () => {
  it('shortens CRS labels and keeps the cached check time', () => {
    expect(displayProvenance('SANDBOX: test identity #13 (cached at 04:30 UTC)')).toBe('CRS · checked 04:30 UTC');
    expect(displayProvenance('CRS sandbox: test identity #7')).toBe('CRS');
  });

  it('shows placeholders as offline records, never as a provider check', () => {
    expect(displayProvenance('FAKE')).toBe('Offline record');
    expect(displayProvenance('FAKE: CRS fixture, test identity #1')).toBe('Offline record');
  });

  it('leaves other labels verbatim', () => {
    expect(displayProvenance('Apify: live run run_AbC123')).toBe('Apify: live run run_AbC123');
    expect(displayProvenance('Apify: run run_X (cached at 17:00 UTC)')).toBe('Apify: run run_X (cached at 17:00 UTC)');
  });

  it('formats a CRS fraud score with its check time', () => {
    expect(crsFraudText({ score: 88, label: 'CRS sandbox: test identity #13 (cached at 18:05 UTC)' })).toBe('88 / 100 · checked 18:05 UTC');
    expect(crsFraudText({ score: 12, label: 'CRS sandbox: test identity #13', checkedAt: '2026-10-25T04:30:12Z' })).toBe('12 / 100 · checked 04:30 UTC');
    expect(crsFraudText({ score: 0, label: 'FAKE: synthetic fraud risk (not checked)' })).toBe('Not checked');
    expect(crsFraudText({ label: 'CRS sandbox: test identity #13' })).toBe('Score not recorded');
  });
});
