import { describe, expect, it } from 'vitest';
import { isActive, navLinks, siteNavHidden, whatsRealLink } from './site-nav';

describe('site nav', () => {
  it('lists only the product pages, with System Status as the small trailing link', () => {
    expect(navLinks.map(link => link.label)).toEqual(['Office', 'Inbox', 'Audit wall', 'Attack lab', 'Operator', 'Controller']);
    expect(navLinks.map(link => link.href as string)).not.toContain('/real-vs-sim');
    expect(whatsRealLink).toEqual({ label: 'System Status', href: '/real-vs-sim' });
  });

  it('marks the active page, treating / as the office', () => {
    expect(isActive('/', '/office')).toBe(true);
    expect(isActive('/office/play', '/office')).toBe(true);
    expect(isActive('/audit', '/audit')).toBe(true);
    expect(isActive('/auditor', '/audit')).toBe(false);
    expect(isActive('/inbox', '/office')).toBe(false);
  });

  it('stays off customer pay pages and embeds', () => {
    for (const placement of ['layout', 'office'] as const) {
      expect(siteNavHidden('/pay/abc', null, placement)).toBe(true);
      expect(siteNavHidden('/pay', null, placement)).toBe(true);
      expect(siteNavHidden('/audit', '1', placement)).toBe(true);
    }
    expect(siteNavHidden('/payment-link', null)).toBe(false);
  });

  it('lets the office own navigation without adding a layout bar', () => {
    for (const path of ['/', '/office', '/office/x']) {
      expect(siteNavHidden(path, null, 'layout')).toBe(true);
      expect(siteNavHidden(path, null, 'office')).toBe(false);
    }
    expect(siteNavHidden('/inbox', null, 'layout')).toBe(false);
  });
});
