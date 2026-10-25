import { describe, expect, it } from 'vitest';
import { officeText, badgeLimit, shortOfficeText, plainWords } from './display';

describe('office display formatting', () => {
  it('formats money and hides machine identifiers without changing invoice numbers', () => {
    expect(officeText('INV-4481 · 85000 cents · 64000 USD cent · audit:38 · judge:abc · review:xyz · demo-collections-1042 · 550e8400-e29b-41d4-a716-446655440000'))
      .toBe('INV-4481 · $850.00 · $640.00 · INV-1042');
  });
  it.each([
    ['200000 cents · Receipt, confirmed', '$2,000.00 · Receipt, confirmed'],
    ['create escalation · agent-review:judge:550e8400-e29b-41d4-a716-446655440000, judge:550e8400-e29b-41d4-a716-446655440000, 4482', 'Escalated to Dana'],
    ['create escalation · agent-, , 4482', 'Escalated to Dana'],
    ['agent narration hold · ,', 'Held for review'],
    ['judge inbox decision · , ,', 'Held for review'],
    ['INV-4482 · create escalation · agent-, , 4482 · Payables · NEEDS YOU', 'INV-4482 · Escalated to Dana · Payables · NEEDS YOU'],
    ['Review needed · agent narration hold · , · Payables', 'Review needed · Held for review · Payables'],
    ['Review needed · judge inbox decision · , , · Team', 'Review needed · Held for review · Team'],
    ['Invoice 4482 (PO-4482), vendorId Pixel', 'Invoice 4482 (PO-4482), vendor Pixel'],
    ['Result · agent-550e8400-e29b-41d4-a716-446655440000, audit:38, · Done', 'Result · Done'],
  ])('cleans live board fragments: %s', (input, expected) => {
    expect(officeText(input)).toBe(expected);
  });
  it('uses the seed vendor display names', () => {
    expect(officeText('vendor:acme · papertrail')).toBe('Acme Supply · Papertrail Print Co');
  });
  it('makes action names readable', () => {
    expect(plainWords('request_room_entry')).toBe('Request room entry');
    expect(plainWords('send_payment_link')).toBe('Send payment link');
  });
  it('finishes at a word boundary', () => {
    expect(shortOfficeText('Held for Dana pending bank change verification', 30)).toBe('Held for Dana pending bank');
  });
  it('humanizes exact subscribed badge limits, including nested values', () => {
    expect(badgeLimit('maxPaymentCents', 200000)).toEqual(['Maximum payment', '$2,000.00']);
    expect(badgeLimit('minFirstPct', 50)).toEqual(['Minimum first payment', '50%']);
    expect(badgeLimit('feesWaivable', false)).toEqual(['Fees waivable', 'no']);
    expect(badgeLimit('other', { maxPlanDays: 30 })).toEqual(['Other', 'Maximum plan days: 30']);
  });
});
