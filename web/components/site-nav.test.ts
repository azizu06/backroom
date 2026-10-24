import { describe, expect, it } from 'vitest';
import { isActive, navLinks, siteNavHidden } from '../lib/site-nav';

describe('site navigation', () => {
  it('lists the seven app destinations in order', () => {
    expect(navLinks).toEqual([
      { label: 'Office', href: '/office' },
      { label: 'Inbox', href: '/inbox' },
      { label: 'Audit wall', href: '/audit' },
      { label: 'Attack demo', href: '/attack' },
      { label: 'Real vs simulated', href: '/real-vs-sim' },
      { label: 'Operator', href: '/operator' },
      { label: 'Controller', href: '/controller' },
    ]);
  });

  it('treats the root as Office only', () => {
    expect(navLinks.filter(link => isActive('/', link.href)).map(link => link.label)).toEqual(['Office']);
  });

  it.each(navLinks)('activates $label on its own page and descendants', ({ href }) => {
    expect(isActive(href, href)).toBe(true);
    expect(isActive(`${href}/`, href)).toBe(true);
    expect(isActive(`${href}/example`, href)).toBe(true);
    expect(isActive(`${href}-other`, href)).toBe(false);
  });

  it('leaves unrelated routes inactive', () => {
    for (const pathname of ['/start', '/policy', '/t8', '/unknown', '/pay/missing-link']) {
      expect(navLinks.some(link => isActive(pathname, link.href))).toBe(false);
    }
    expect(isActive('/start', '/start')).toBe(true);
    expect(isActive('/controller', '/controller')).toBe(true);
  });

  it('hides embeds and customer payment routes, and keeps a single bar on the office', () => {
    for (const pathname of ['/start', '/office', '/', '/pay/missing-link']) {
      expect(siteNavHidden(pathname, '1', 'layout')).toBe(true);
      expect(siteNavHidden(pathname, '1', 'office')).toBe(true);
    }
    expect(siteNavHidden('/pay/missing-link', null, 'layout')).toBe(true);
    expect(siteNavHidden('/pay', null, 'office')).toBe(true);
    expect(siteNavHidden('/payment-link', null, 'layout')).toBe(false);
    expect(siteNavHidden('/approve/abc', null, 'layout')).toBe(false);
    expect(siteNavHidden('/office', null, 'layout')).toBe(true);
    expect(siteNavHidden('/office/replay', null, 'layout')).toBe(true);
    expect(siteNavHidden('/', null, 'layout')).toBe(true);
    expect(siteNavHidden('/office-other', null, 'layout')).toBe(false);
    expect(siteNavHidden('/office', null, 'office')).toBe(false);
    expect(siteNavHidden('/', null, 'office')).toBe(false);
    expect(siteNavHidden('/start', null, 'layout')).toBe(false);
    expect(siteNavHidden('/audit', null, 'layout')).toBe(false);
    expect(siteNavHidden('/controller', null, 'layout')).toBe(false);
  });
});
