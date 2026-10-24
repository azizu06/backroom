import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { createElement, type ReactElement } from 'react';
import { createRequire } from 'node:module';
import { errorReference } from '../../components/RouteState';
import NotFound from '../../app/not-found';
import RouteError from '../../app/error';
import GlobalError from '../../app/global-error';

// web/ has no @types/react-dom; type the one server renderer used here.
const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as { renderToStaticMarkup: (node: ReactElement) => string };
// web/ compiles TSX with the classic runtime under vitest; Next uses its own transform.
Object.assign(globalThis, { React });

describe('route states', () => {
  it('404 has one h1 and links back to the office and audit wall', () => {
    const html = renderToStaticMarkup(createElement(NotFound));
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('404 · Not found');
    expect(html).toContain('href="/office"');
    expect(html).toContain('href="/audit"');
  });

  it('error shows a safe digest only, never the thrown message', () => {
    const error = Object.assign(new Error('secret upstream detail sk-test'), { digest: 'abc123' });
    const html = renderToStaticMarkup(createElement(RouteError, { error, retry: () => {} }));
    expect(html).toContain('Try again');
    expect(html).toContain('role="alert"');
    expect(html).toContain('<code>abc123</code>');
    expect(html).not.toContain('secret upstream detail');
  });

  it('global error renders its own document', () => {
    const error = Object.assign(new Error('layout secret sk-test'), { digest: 'def456' });
    const html = renderToStaticMarkup(createElement(GlobalError, { error, retry: () => {} }));
    expect(html.startsWith('<html lang="en">')).toBe(true);
    expect(html).toContain('<title>');
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
