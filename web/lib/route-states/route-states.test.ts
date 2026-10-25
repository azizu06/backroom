import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { createRequire } from 'node:module';
import { errorReference } from '../../components/RouteState';
import NotFound from '../../app/not-found';
import RouteError from '../../app/error';
import GlobalError from '../../app/global-error';
import RootLayout from '../../app/layout';

vi.mock('next/navigation', () => ({
  usePathname: () => '/no-such-room',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', async () => {
  const { createElement: create } = await import('react');
  return {
    default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => create('a', { ...props, href }, children),
  };
});

// web/ has no @types/react-dom; type the one server renderer used here.
const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as { renderToStaticMarkup: (node: ReactElement) => string };
// web/ compiles TSX with the classic runtime under vitest; Next uses its own transform.
Object.assign(globalThis, { React });

const failure = 'Rendering failed. An action may already have completed. Check the audit record (/audit) before retrying.';

describe('route states', () => {
  it('404 has one h1, no nav of its own, and one way back to the office', () => {
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('404 · Not found');
    expect(html).toContain('Nothing was changed');
    expect(html).toContain('<a href="/office">Back to the office</a>');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain('<nav');
    expect(html).not.toContain('href="/audit"');
  });

  it('404 page has exactly one nav landmark, the shared site nav', () => {
    const html = renderToStaticMarkup(createElement(RootLayout, null, createElement(NotFound)));
    expect(html.match(/<nav[\s>]/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Site"');
    expect(html).toContain('href="/audit"');
    expect(html).toContain('href="/office"');
    expect(html).not.toContain('aria-label="Recovery"');
    expect(html).not.toContain('<header');
  });

  it('error shows a safe digest only, never the thrown message', () => {
    const error = Object.assign(new Error('secret upstream detail sk-test'), { digest: 'abc123' });
    const html = renderToStaticMarkup(createElement(RouteError, { error, retry: () => {} }));
    expect(html).toContain('Try again');
    expect(html).toContain('role="alert"');
    expect(html).toContain(failure);
    expect(html).not.toContain('no payment');
    expect(html).not.toContain('Nothing was changed');
    expect(html).toContain('<code>abc123</code>');
    expect(html).not.toContain('secret upstream detail');
    expect(html).not.toContain('<nav');
    expect(html).toContain('<a href="/office">Back to the office</a>');
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it('global error renders its own document and a header in place of the site nav', () => {
    const error = Object.assign(new Error('layout secret sk-test'), { digest: 'def456' });
    const html = renderToStaticMarkup(createElement(GlobalError, { error, retry: () => {} }));
    expect(html.startsWith('<html lang="en">')).toBe(true);
    expect(html).toContain('<title>');
    expect(html).toContain(failure);
    expect(html).not.toContain('no payment');
    expect(html).not.toContain('Nothing was changed');
    expect(html).toContain('<a href="/office">Backroom</a>');
    expect(html).toContain('<a href="/audit">Audit Wall</a>');
    expect(html).not.toContain('<nav');
    expect(html).not.toContain('Back to the office');
    expect(html).toContain('<code>def456</code>');
    expect(html).not.toContain('layout secret');
  });

  it('errorReference ignores missing, non-string and unsafe digests', () => {
    expect(errorReference(undefined)).toBeUndefined();
    expect(errorReference('x')).toBeUndefined();
    expect(errorReference({ digest: 42 })).toBeUndefined();
    expect(errorReference({ digest: '<script>' })).toBeUndefined();
    expect(errorReference({ digest: '1234-abcd' })).toBe('1234-abcd');
  });
});
