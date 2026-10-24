import { describe, expect, it } from 'vitest';
import { isActive, navLinks } from '../lib/site-nav';

describe('site navigation', () => {
  it('lists the internal destinations in order, without operator tools', () => {
    expect(navLinks).toEqual([
      { label: 'Office', href: '/office' },
      { label: 'Inbox', href: '/inbox' },
      { label: 'Audit', href: '/audit' },
      { label: 'Policy', href: '/policy' },
      { label: 'Real vs Sim', href: '/real-vs-sim' },
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

  it('leaves the office links inactive on the start page and unknown routes', () => {
    for (const pathname of ['/start', '/controller', '/t8', '/unknown']) {
      expect(navLinks.some(link => isActive(pathname, link.href))).toBe(false);
    }
    expect(isActive('/start', '/start')).toBe(true);
  });
});
