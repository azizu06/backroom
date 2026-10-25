import { describe, expect, it } from 'vitest';
import { paymentLinkToAnnounce } from './payment-toast';

describe('payment link toast', () => {
  const link = { code: 'K7Q2', expiresAt: 10_000 };
  it('announces a live link the viewer has not seen', () => {
    expect(paymentLinkToAnnounce(link, new Set(), 5_000)).toEqual(link);
  });
  it('stays quiet for no link, an expired link or one already announced', () => {
    expect(paymentLinkToAnnounce(null, new Set(), 5_000)).toBeNull();
    expect(paymentLinkToAnnounce(link, new Set(), 10_000)).toBeNull();
    expect(paymentLinkToAnnounce(link, new Set(['K7Q2']), 5_000)).toBeNull();
    expect(paymentLinkToAnnounce({ code: '', expiresAt: 10_000 }, new Set(), 5_000)).toBeNull();
  });
  it('announces the next call’s link after an earlier one', () => {
    expect(paymentLinkToAnnounce({ code: 'Z9P4', expiresAt: 20_000 }, new Set(['K7Q2']), 5_000)?.code).toBe('Z9P4');
  });
});
