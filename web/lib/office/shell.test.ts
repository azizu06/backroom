import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { createRequire } from 'node:module';
import RootLayout from '../../app/layout';
import { MockOffice } from '../../app/office/Office';

const route = vi.hoisted(() => ({ pathname: '/office' }));
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', async () => {
  const { createElement: create } = await import('react');
  return { default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => create('a', { ...props, href }, children) };
});
const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as { renderToStaticMarkup: (node: ReactElement) => string };
Object.assign(globalThis, { React });

describe('office layout ownership', () => {
  it.each(['/', '/office', '/office/x'])('composes one topbar and sidebar navigation on %s', pathname => {
    route.pathname = pathname;
    const html = renderToStaticMarkup(createElement(RootLayout, null, createElement(MockOffice)));
    expect(html.match(/data-testid="office-topbar"/g)).toHaveLength(1);
    expect(html.match(/aria-label="Site pages"/g)).toHaveLength(1);
    expect(html).not.toContain('class="site-nav"');
    expect(html.match(/class="office-sidebar-links"/g)).toHaveLength(1);
    const sidebar = html.slice(html.indexOf('<aside class="office-sidebar"'), html.indexOf('<div class="office-main"'));
    for (const path of ['/attack', '/operator', '/controller', '/real-vs-sim']) expect(sidebar).toContain(`href="${path}"`);
    expect(sidebar).toMatch(/<button[^>]*>.*?Inbox · /);
    expect(sidebar).toMatch(/<button[^>]*>.*?Audit Wall<\/button>/);
    expect(sidebar).not.toContain('href="/inbox"');
    expect(sidebar).not.toContain('href="/audit"');
    expect(html).toContain('aria-label="System Status"');
    expect(html).toContain('<strong>Info</strong>');
    expect(html).toContain('aria-label="Office shortcuts"');
    expect(html).toContain('>Rooms</button>');
    expect(html).toContain('class="bubbles"');
    // #311 removed the demo disclosure pill.
    expect(html).not.toContain('aria-label="Demo disclosure"');
    expect(html.match(/id="office-view"/g)).toHaveLength(1);
    expect(html).toContain('Story mode');
    expect(html).toContain('data-office-mode="overview"');
    const topbar = html.slice(html.indexOf('data-testid="office-topbar"'), html.indexOf('data-testid="office-viewport"'));
    expect(topbar).toContain('class="connection-status"');
    expect(topbar).toContain('class="llm-control"');
    expect(topbar).not.toContain('hidden=');
    expect(html).not.toContain('office-corner-toggle');
    expect(html).not.toContain('office-drawer');
    expect(html).not.toContain('agent-tag-pick');
    expect(html).not.toContain('class="overview-map"');
    expect(html).not.toContain('class="play-hud"');
  });
});
