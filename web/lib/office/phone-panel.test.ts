import { createElement, useState, type ReactElement } from 'react';
import * as React from 'react';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeskPhonePanel } from '../../app/office/props/DeskPhonePanel';

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof React>();
  return { ...actual, useState: vi.fn(actual.useState) };
});
vi.mock('../../app/office/props/desk-phone.css', () => ({}));

const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as { renderToStaticMarkup: (node: ReactElement) => string };
Object.assign(globalThis, { React });

describe('desk phone request result', () => {
  afterEach(() => { vi.mocked(useState).mockReset(); });

  it('links to the operator unlock when the host says calls are locked', () => {
    vi.mocked(useState).mockReturnValueOnce([{ ok: false, reason: 'locked', message: 'Calls are locked.' }, () => {}]);
    const html = renderToStaticMarkup(createElement(DeskPhonePanel));
    expect(html).toContain('Calls are locked.');
    expect(html).toContain('href="/calls"');
    expect(html).toContain('>Unlock calls</a>');
  });

  it('does not offer the unlock link for any other request result', () => {
    vi.mocked(useState).mockReturnValueOnce([{ ok: false, reason: 'failed', message: 'Call request unavailable' }, () => {}]);
    const html = renderToStaticMarkup(createElement(DeskPhonePanel));
    expect(html).toContain('Call request unavailable');
    expect(html).not.toContain('Unlock calls');
    expect(html).not.toContain('href="/calls"');
  });
});
