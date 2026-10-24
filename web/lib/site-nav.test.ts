// Vitest discovers lib/** tests; keep the component contract test beside SiteNav.
// web/ compiles TSX with the classic runtime under vitest; Next uses its own transform.
import * as React from 'react';
import { createElement, type ReactNode } from 'react';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { navLinks } from './site-nav';
import { SiteNav } from '../components/SiteNav';
import '../components/site-nav.test';

Object.assign(globalThis, { React });

const navState = vi.hoisted(() => ({ pathname: '/start', search: '' }));
vi.mock('next/navigation', () => ({
  usePathname: () => navState.pathname,
  useSearchParams: () => new URLSearchParams(navState.search),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => createElement('a', { ...props, href }, children),
}));

const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as {
  renderToStaticMarkup: (node: ReactNode) => string;
};

function markup(placement?: 'office') {
  return renderToStaticMarkup(createElement(SiteNav, placement ? { placement } : {}));
}

function currentLabels(html: string) {
  return [...html.matchAll(/<a\b([^>]*)>([^<]*)<\/a>/g)]
    .filter(([, attrs]) => attrs?.includes('aria-current="page"'))
    .map(([, , label]) => label);
}

describe('SiteNav rendering', () => {
  it('renders the seven links and marks the active page', () => {
    navState.pathname = '/audit';
    navState.search = '';
    const html = markup();
    expect(html).toContain('aria-label="Site"');
    expect(currentLabels(html)).toEqual(['Audit wall']);
    for (const link of navLinks) {
      expect(html).toContain(`href="${link.href}"`);
      expect(html).toContain(`>${link.label}</a>`);
    }
  });

  it('omits the layout bar on the office, in embeds, and on customer payment routes', () => {
    navState.pathname = '/office';
    navState.search = '';
    expect(markup()).toBe('');
    const office = markup('office');
    expect(office).toContain('aria-label="Site"');
    expect(currentLabels(office)).toEqual(['Office']);
    navState.pathname = '/';
    expect(markup()).toBe('');
    expect(currentLabels(markup('office'))).toEqual(['Office']);
    navState.pathname = '/start';
    navState.search = 'embed=1';
    expect(markup()).toBe('');
    expect(markup('office')).toBe('');
    navState.pathname = '/pay/missing-link';
    navState.search = '';
    expect(markup()).toBe('');
    expect(markup('office')).toBe('');
    navState.search = 'embed=0';
    navState.pathname = '/inbox';
    const inbox = markup();
    expect(currentLabels(inbox)).toEqual(['Inbox']);
  });
});

describe('judge start page', () => {
  it('keeps the story URL and describes escalation as a visual fixture with an inbox approval link', async () => {
    // Module-scope JSX in the page runs at import, so React is installed on globalThis first.
    const { default: StartPage } = await import('../app/start/page');
    const html = renderToStaticMarkup(createElement(StartPage));
    expect(html).toContain('href="/office?demo=story"');
    expect(html).toContain('>Story mode</a>');
    expect(html).toContain('>Visual escalation preview</a>');
    expect(html).toContain('href="/office"');
    expect(html).toContain('visual fixture');
    expect(html).toContain('seeded approval');
    expect(html).toContain('href="/inbox"');
    expect(html).toContain('>inbox</a>');
    expect(html).not.toContain('its approval link');
    expect(html).not.toContain('Preview escalation” below the office: the agent');
  });
});
