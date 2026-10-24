import * as React from 'react';
// @ts-ignore -- react-dom ships no types and @types/react-dom is not a workspace dependency.
import * as ReactDOMServer from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { RealVsSim } from '../components/RealVsSim';
import { disclosureItems, getDisclosureStatus, NARROW_PANEL_QUERY, NOT_PROBED_LABEL, panelExpanded, probedServices, toggledPanel, unprobedServices } from './real-vs-sim';

const { renderToString } = ReactDOMServer as { renderToString(node: React.ReactNode): string };
vi.mock('next/navigation', () => ({ usePathname: () => '/office', useSearchParams: () => new URLSearchParams() }));

const unprobed = ['phone', 'claude', 'apify', 'policy', 'spacetime'] as const;
const item = (id: string) => disclosureItems.find(row => row.id === id)!;

describe('demo disclosure status', () => {
  it('does not claim live services are online without evidence', () => {
    expect(getDisclosureStatus(item('gx10'), null).label).toBe('Unverified');
    for (const id of unprobed) expect(getDisclosureStatus(item(id), null).label).toBe(NOT_PROBED_LABEL);
  });
});

const snapshot = (overrides = {}): import('./real-vs-sim').DemoStatus => ({
  measuredAt: new Date().toISOString(), notProbed: [...unprobedServices], llmEnabled: true, gx10: null, ...overrides,
});

it('lists every real integration as either probed here or explicitly not probed', () => {
  expect([...probedServices]).toEqual(['gx10']);
  expect([...unprobedServices].sort()).toEqual([...unprobed].sort());
});

it('labels never-probed services honestly instead of Unverified, even with a fresh or stale snapshot', () => {
  const old = new Date(Date.now() - 60_000).toISOString();
  for (const id of unprobed) {
    for (const status of [snapshot(), snapshot({ measuredAt: old }), snapshot({ gx10: { localEnabled: true, localAvailable: true, checkedAt: new Date().toISOString() } })]) {
      expect(getDisclosureStatus(item(id), status)).toEqual({ label: NOT_PROBED_LABEL, tone: 'neutral' });
    }
  }
});

it('still reports the observed LLM OFF switch for unprobed model-dependent services', () => {
  for (const id of ['phone', 'claude']) expect(getDisclosureStatus(item(id), snapshot({ llmEnabled: false })).label).toBe('LLM OFF');
  for (const id of ['apify', 'policy', 'spacetime']) expect(getDisclosureStatus(item(id), snapshot({ llmEnabled: false })).label).toBe(NOT_PROBED_LABEL);
});

it('reserves Unverified for the probed GX10 without a fresh observation', () => {
  expect(getDisclosureStatus(item('gx10'), snapshot()).label).toBe('Unverified');
});
const gx10 = disclosureItems.find(item => item.id === 'gx10')!;

it('never mistakes the router optimistic initial state for an observed online model', () => {
  expect(getDisclosureStatus(gx10, snapshot({ gx10: { localEnabled: true, localAvailable: true, checkedAt: null } })).label).toBe('Unverified');
});

it.each([true, false])('reports observed GX10 availability %s', available => {
  expect(getDisclosureStatus(gx10, snapshot({ gx10: { localEnabled: true, localAvailable: available, checkedAt: new Date().toISOString() } })).label).toBe(available ? 'Online' : 'Offline');
});

it('shows OFF for model-dependent integrations while preserving sandbox disclosure', () => {
  for (const id of ['phone', 'claude', 'gx10']) {
    expect(getDisclosureStatus(disclosureItems.find(item => item.id === id)!, snapshot({ llmEnabled: false })).label).toBe('LLM OFF');
  }
  expect(getDisclosureStatus(disclosureItems.find(item => item.id === 'nessie')!, snapshot({ llmEnabled: false })).label).toBe('Simulated');
});

it('discards stale status snapshots and stale health observations', () => {
  const old = new Date(Date.now() - 60_000).toISOString();
  expect(getDisclosureStatus(gx10, snapshot({ measuredAt: old, llmEnabled: false })).label).toBe('Unverified');
  expect(getDisclosureStatus(gx10, snapshot({ gx10: { localEnabled: true, localAvailable: true, checkedAt: old } })).label).toBe('Unverified');
});

it('distinguishes a disabled local model from an offline one', () => {
  expect(getDisclosureStatus(gx10, snapshot({ gx10: { localEnabled: false, localAvailable: false, checkedAt: null } })).label).toBe('Disabled');
});

describe('disclosure panel expansion', () => {
  it('collapses by default only at the narrow breakpoint', () => {
    expect(NARROW_PANEL_QUERY).toBe('(max-width: 760px)');
    expect(panelExpanded({ detailed: false, narrow: true, userExpanded: null })).toBe(false);
    expect(panelExpanded({ detailed: false, narrow: false, userExpanded: null })).toBe(true);
  });

  it('keeps the details page expanded regardless of viewport or toggle', () => {
    for (const narrow of [true, false]) for (const userExpanded of [null, true, false]) {
      expect(panelExpanded({ detailed: true, narrow, userExpanded })).toBe(true);
    }
  });

  it('flips on toggle and lets the user choice win over the viewport default', () => {
    for (const narrow of [true, false]) {
      const initial = panelExpanded({ detailed: false, narrow, userExpanded: null });
      const toggled = panelExpanded({ detailed: false, narrow, userExpanded: toggledPanel(initial) });
      expect(toggled).toBe(!initial);
      expect(panelExpanded({ detailed: false, narrow, userExpanded: toggledPanel(toggled) })).toBe(initial);
      expect(panelExpanded({ detailed: false, narrow: !narrow, userExpanded: toggledPanel(initial) })).toBe(!initial);
    }
  });

  it('server-renders the toggle with aria-expanded and aria-controls bound to the panel body', () => {
    // Vitest compiles the component's JSX with the classic runtime; harmless if that ever changes.
    vi.stubGlobal('React', React);
    let html: string;
    try { html = renderToString(React.createElement(RealVsSim)); } finally { vi.unstubAllGlobals(); }
    const button = html.match(/<button[^>]*class="real-sim-toggle"[^>]*>/)?.[0] ?? '';
    const expanded = /aria-expanded="(true|false)"/.exec(button)?.[1];
    const controls = /aria-controls="([^"]+)"/.exec(button)?.[1];
    expect(expanded).toBe(String(panelExpanded({ detailed: false, narrow: false, userExpanded: null })));
    expect(controls).toBeTruthy();
    expect(html).toMatch(new RegExp(`<aside[^>]*data-expanded="${expanded}"`));
    const body = html.match(new RegExp(`<div id="${controls}"[^>]*>`))?.[0];
    expect(body).toBeDefined();
    expect(body).not.toContain('hidden');
    expect(html).toContain('>Hide<');
    expect(html).not.toContain('>Show<');
  });
});
