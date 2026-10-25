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
    // The seven pages are grouped into four task buttons that open tabbed sheets instead of routing away.
    expect([...sidebar.matchAll(/data-group="([a-z]+)"/g)].map(match => match[1])).toEqual(['calls', 'approvals', 'attack', 'setup']);
    for (const path of ['/calls', '/attack', '/policy', '/controller', '/payment-link', '/operator', '/real-vs-sim']) expect(sidebar).not.toMatch(new RegExp(` href="${path}"`));

    expect(sidebar).toContain('<span>Backroom</span>');
    expect(html).not.toContain('Backrooms');
    expect(html).toContain('3D office view. Click a room');
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
    expect(html).toContain('Story Mode');
    expect(html).toContain('data-office-mode="overview"');
    const topbar = html.slice(html.indexOf('data-testid="office-topbar"'), html.indexOf('data-testid="office-viewport"'));
    expect(topbar).toContain('class="connection-status"');
    expect(topbar).toContain('class="llm-control"');
    expect(topbar).not.toContain('hidden=');
    // The theme switch sits beside the topbar pill, not inside it.
    // (ThemeToggle renders after hydration, so SSR shows only the row it joins.)
    expect(html).toContain('<div class="office-topbar-row"><header class="office-toolbar"');
    expect(topbar.slice(0, topbar.indexOf('</header>'))).not.toContain('theme-toggle');
    expect(html).toMatch(/class="office-view-controls"><button[^>]*class="office-sound-toggle"[^>]*aria-label="Sound off"/);
    expect(html).toContain('aria-label="Full Screen"');
    expect(html).not.toContain('data-fullscreen');
    expect(html).toContain('>Play (First Person)</button>');
    const views = html.slice(html.indexOf('id="office-view"'), html.indexOf('</select>', html.indexOf('id="office-view"')));
    expect(views).not.toContain('Fixed camera');
    expect(views).not.toContain('value="play"');
    const help = html.slice(html.indexOf('aria-label="Help"'), html.indexOf('</aside>'));
    expect(help).toContain('>Help</button>');
    expect(html).not.toContain('office-corner-toggle');
    expect(html).not.toContain('office-drawer');
    expect(html).not.toContain('agent-tag-pick');
    expect(html).not.toContain('class="overview-map"');
    expect(html).not.toContain('class="play-hud"');
  });
});
