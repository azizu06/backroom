import * as React from 'react';
// @ts-ignore -- react-dom ships no types and @types/react-dom is not a workspace dependency.
import * as ReactDOMServer from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DisclosureRow, RealVsSim } from '../components/RealVsSim';
import { disclosureItems, getDisclosureStatus, NARROW_PANEL_QUERY, NOT_PROBED_LABEL, panelExpanded, probedServices, toggledPanel, unprobedServices, type DemoStatus, type ServiceId } from './real-vs-sim';

const { renderToString } = ReactDOMServer as { renderToString(node: React.ReactNode): string };
vi.mock('next/navigation', () => ({ usePathname: () => '/office', useSearchParams: () => new URLSearchParams() }));

const realIds = ['phone', 'claude', 'gx10', 'apify', 'policy', 'spacetime'] as const;
const item = (id: string) => disclosureItems.find(row => row.id === id)!;
const NOW = Date.parse('2026-10-24T13:10:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
type Probe = NonNullable<DemoStatus['services']>[ServiceId];

const snapshot = (overrides: Partial<DemoStatus> = {}): DemoStatus => ({
  measuredAt: iso(NOW), notProbed: [...unprobedServices], llmEnabled: true, gx10: null, ...overrides,
});
const withProbe = (id: ServiceId, probe: Probe, overrides: Partial<DemoStatus> = {}) => snapshot({ services: { [id]: probe }, ...overrides });

describe('demo disclosure status', () => {
  it('does not claim live services are online without evidence', () => {
    for (const id of realIds) expect(getDisclosureStatus(item(id), null)).toEqual({ label: 'Unverified', tone: 'neutral' });
  });

  it('probes every real integration, so nothing is listed as never probed', () => {
    expect([...probedServices].sort()).toEqual([...realIds].sort());
    expect(unprobedServices).toEqual([]);
    for (const row of disclosureItems.filter(row => row.kind === 'real')) expect(row.description).not.toMatch(/not yet reported/i);
  });

  it('labels a verified receipt with its evidence and UTC date', () => {
    const state = getDisclosureStatus(item('policy'), withProbe('policy', {
      state: 'verified', source: 'receipt', evidence: 'Receipt: DENY FEES_NON_WAIVABLE, ALLOW IN_BADGE', at: '2026-10-24T09:49:22.179Z',
    }), NOW);
    expect(state).toEqual({ label: 'Verified', tone: 'good', detail: 'Receipt: DENY FEES_NON_WAIVABLE, ALLOW IN_BADGE · Oct 24, 09:49 UTC' });
  });

  it('labels a fresh live probe with a UTC clock time and expires it after 120 s', () => {
    const probe: Probe = { state: 'verified', source: 'live', evidence: 'GET /models · 5 models', at: '2026-10-24T13:09:12.000Z' };
    expect(getDisclosureStatus(item('gx10'), withProbe('gx10', probe), NOW))
      .toEqual({ label: 'Verified', tone: 'good', detail: 'GET /models · 5 models · 13:09:12 UTC' });
    const later = NOW + 120_000;
    expect(getDisclosureStatus(item('gx10'), withProbe('gx10', probe, { measuredAt: iso(later) }), later).label).toBe('Unverified');
  });

  it('never returns Verified without a parseable evidence time', () => {
    for (const source of ['live', 'receipt'] as const) for (const at of [null, 'not a date']) {
      const state = getDisclosureStatus(item('apify'), withProbe('apify', { state: 'verified', source, evidence: 'Run x', at }), NOW);
      expect(state.label).toBe('Unverified');
      expect(state.tone).toBe('neutral');
    }
  });

  it.each([
    ['simulated', 'Simulated', 'neutral', 'In-memory state fixture'],
    ['unreachable', 'Unreachable', 'warning', 'Timed out'],
    ['disabled', 'Disabled', 'warning', 'Disabled by config'],
    ['unverified', 'Unverified', 'neutral', 'Not configured'],
  ] as const)('maps %s probes to %s with the evidence as detail', (state, label, tone, evidence) => {
    expect(getDisclosureStatus(item('spacetime'), withProbe('spacetime', { state, source: 'config', evidence, at: null }), NOW))
      .toEqual({ label, tone, detail: evidence });
  });

  it('lets LLM OFF win over probe evidence for model-dependent services only', () => {
    const verified: Probe = { state: 'verified', source: 'receipt', evidence: 'Route receipt req_1', at: iso(NOW - 3600_000) };
    for (const id of ['phone', 'claude', 'gx10'] as const) {
      expect(getDisclosureStatus(item(id), withProbe(id, verified, { llmEnabled: false }), NOW)).toEqual({ label: 'LLM OFF', tone: 'warning' });
    }
    for (const id of ['apify', 'policy', 'spacetime'] as const) {
      expect(getDisclosureStatus(item(id), withProbe(id, verified, { llmEnabled: false }), NOW).label).toBe('Verified');
    }
    expect(getDisclosureStatus(item('nessie'), snapshot({ llmEnabled: false }), NOW).label).toBe('Simulated');
  });

  it('discards stale status snapshots even with verified evidence', () => {
    const verified: Probe = { state: 'verified', source: 'receipt', evidence: 'Run x', at: iso(NOW - 3600_000) };
    for (const id of realIds) {
      expect(getDisclosureStatus(item(id), withProbe(id, verified, { measuredAt: iso(NOW - 31_000), llmEnabled: false }), NOW))
        .toEqual({ label: 'Unverified', tone: 'neutral' });
    }
  });

  it('labels ids the server lists as not probed honestly', () => {
    for (const id of ['apify', 'policy', 'spacetime'] as const) {
      expect(getDisclosureStatus(item(id), snapshot({ notProbed: [id] }), NOW)).toEqual({ label: NOT_PROBED_LABEL, tone: 'neutral' });
    }
  });

  it('falls back to Unverified when a fresh snapshot has no entry for a service', () => {
    for (const id of ['phone', 'claude', 'apify', 'policy', 'spacetime'] as const) {
      expect(getDisclosureStatus(item(id), snapshot(), NOW)).toEqual({ label: 'Unverified', tone: 'neutral' });
    }
  });
});

it('shows Checking while the first server probe run is pending', () => {
  for (const id of ['phone', 'claude', 'gx10', 'apify', 'policy', 'spacetime'] as const) {
    expect(getDisclosureStatus(item(id), snapshot({ notProbed: [], services: {}, probesCheckedAt: null }), NOW)).toEqual({ label: 'Checking…', tone: 'neutral' });
  }
});

describe('GX10 router health fallback without a probe entry', () => {
  const gx10 = item('gx10');
  it('never mistakes the router optimistic initial state for an observed online model', () => {
    expect(getDisclosureStatus(gx10, snapshot({ gx10: { localEnabled: true, localAvailable: true, checkedAt: null } }), NOW).label).toBe('Unverified');
  });

  it.each([true, false])('reports observed GX10 availability %s', available => {
    expect(getDisclosureStatus(gx10, snapshot({ gx10: { localEnabled: true, localAvailable: available, checkedAt: iso(NOW) } }), NOW).label).toBe(available ? 'Online' : 'Offline');
  });

  it('discards stale health observations', () => {
    expect(getDisclosureStatus(gx10, snapshot({ gx10: { localEnabled: true, localAvailable: true, checkedAt: iso(NOW - 60_000) } }), NOW).label).toBe('Unverified');
  });

  it('distinguishes a disabled local model from an offline one', () => {
    expect(getDisclosureStatus(gx10, snapshot({ gx10: { localEnabled: false, localAvailable: false, checkedAt: null } }), NOW).label).toBe('Disabled');
  });

  it('prefers the probe entry over router health', () => {
    const status = snapshot({
      gx10: { localEnabled: true, localAvailable: true, checkedAt: iso(NOW) },
      services: { gx10: { state: 'unreachable', source: 'live', evidence: 'HTTP 503', at: iso(NOW) } },
    });
    expect(getDisclosureStatus(gx10, status, NOW)).toEqual({ label: 'Unreachable', tone: 'warning', detail: 'HTTP 503' });
  });
});

describe('disclosure rows', () => {
  const render = (node: React.ReactNode) => {
    vi.stubGlobal('React', React);
    try { return renderToString(node); } finally { vi.unstubAllGlobals(); }
  };
  const status = withProbe('apify', { state: 'verified', source: 'receipt', evidence: 'Run guBODDnPcXO4bX1Ph', at: '2026-10-24T09:26:09.587Z' });

  it.each([false, true])('server-renders the evidence detail line (detailed=%s)', detailed => {
    const html = render(React.createElement(DisclosureRow, { item: item('apify'), status, detailed, now: NOW }));
    expect(html).toContain('>Verified<');
    expect(html).toMatch(/<p class="real-sim-detail-line"[^>]*>Run guBODDnPcXO4bX1Ph · Oct 24, 09:26 UTC<\/p>/);
    expect(html.includes(item('apify').description)).toBe(detailed);
  });

  it('omits the detail line when there is no evidence', () => {
    const html = render(React.createElement(DisclosureRow, { item: item('apify'), status: null, detailed: false }));
    expect(html).toContain('>Unverified<');
    expect(html).not.toContain('real-sim-detail-line');
  });
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
