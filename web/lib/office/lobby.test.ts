import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { createElement, type ReactElement } from 'react';
import { createRequire } from 'node:module';
import { AskWhyVoice, askWhyErrorMessage } from '../../components/AskWhyVoice';
import { AuditWall, type AuditSnapshot } from '../../components/AuditWall';
import { LiveOffice } from '../../app/office/LiveOffice';
import { MockOffice, Office } from '../../app/office/Office';
import { RoomInspector } from '../../app/office/RoomInspector';
import { createMockOfficeState } from './preview';

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof React>();
  return { ...actual, useState: vi.fn(actual.useState), useEffect: vi.fn(actual.useEffect) };
});

// web/ has no @types/react-dom; type the one server renderer used here.
const { renderToStaticMarkup } = createRequire(import.meta.url)('react-dom/server') as { renderToStaticMarkup: (node: ReactElement) => string };
// web/ compiles TSX with the classic runtime under vitest; Next uses its own transform.
Object.assign(globalThis, { React });

function lobby(html: string) {
  const start = html.indexOf("id=\"office-audit-wall\"");
  expect(start).toBeGreaterThan(-1);
  return html.slice(start);
}
function expectLobby(html: string) {
  const section = lobby(html);
  expect(section).toContain('data-office-mount="audit-wall"');
  expect(section).toContain('data-office-mount="audit-wall-live"');
  expect(section).toContain('class="audit-wall"');
  expect(section).toContain('<h3 id="audit-title">Audit wall</h3>');
  // No `recording`: the wall polls /api/audit/entries instead of showing a replay.
  expect(section).toContain('Every decision in this run');
  expect(section).toContain('Loading audit records');
  expect(section).not.toContain('REPLAY');
  expect(section).toContain('data-office-mount="ask-why"');
  expect(section).toContain('aria-label="Ask why by voice"');
  expect(section).toContain('Hold to ask why');
  // The snapshot.audit receipt list is gone.
  expect(section).not.toContain('Walkthrough receipts');
  expect(section).not.toContain('Subscribed receipts');
  expect(section).not.toContain('data-audit-id=');
}

describe('office lobby', () => {
  it('mounts the live audit wall and ask-why in the preview office', () => {
    const html = renderToStaticMarkup(createElement(MockOffice));
    expect(html).toContain('class="office-toolbar office-corner"');
    expect(html).toContain('data-testid="office-viewport"');
    expect(html).toContain('class="office-footer office-drawer"');
    expect(html).toContain('class="seat-statuses"');
    expect(html).toContain('class="mock-controls"');
    // Operator is reached through the shared site nav (lib/site-nav.ts), not an office toolbar link.
    expect(html.slice(html.indexOf('class="office-toolbar"'))).not.toContain('<a href="/operator">Operator</a>');
    expect(html).toContain('href="/inbox"');
    expect(html).toContain('Receipts there are not synced into this static scene.');
    expectLobby(html);
  });

  it('links the standalone judge inbox from the preview inspector', () => {
    const snapshot = createMockOfficeState().source.getSnapshot();
    const html = renderToStaticMarkup(createElement(RoomInspector, { room: 'lobby', snapshot, close: () => {} }));
    expect(html).toContain('data-office-mount="inbox-inspector"');
    expect(html).toContain('href="/inbox"');
    expect(html).toContain('not synced into this static scene');
    expect(html).not.toContain('href="#office-inbox-tray"');
  });

  it('mounts the live audit wall and ask-why in the live office, beside the inbox tray', () => {
    const html = renderToStaticMarkup(createElement(LiveOffice, { config: { uri: 'ws://127.0.0.1:1', database: 'lobby-test' }, presets: [] }));
    expectLobby(html);
    expect(html).toContain('data-office-mount="inbox"');
    expect(html.indexOf('id="office-audit-wall"')).toBeLessThan(html.indexOf('id="office-inbox-tray"'));
  });

  it('keeps the receipt fallback for callers without a wall (replay)', () => {
    const html = renderToStaticMarkup(createElement(Office, { source: createMockOfficeState().source }));
    expect(lobby(html)).toContain('Lobby audit wall');
    expect(html).not.toContain('class="audit-wall"');
    expect(html).not.toContain('data-office-mount="ask-why"');
  });

  it('disables voice and text questions with a visible broken-chain reason', () => {
    const reason = askWhyErrorMessage(409, false, 'AUDIT_CHAIN_BROKEN');
    const html = renderToStaticMarkup(createElement(AskWhyVoice, { disabled: true, disabledReason: reason }));
    expect(html).toContain('The audit chain is broken');
    expect(html).toContain('AUDIT_CHAIN_BROKEN');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Hold to ask why<\/button>/);
    expect(html).toMatch(/<input[^>]*disabled=""/);
    expect(html).toContain('<button type="submit" disabled="">Ask why</button>');
  });

  it('explains AUDIT_CHAIN_BROKEN for both voice and text 409 responses', () => {
    for (const voice of [false, true]) {
      expect(askWhyErrorMessage(409, voice, 'AUDIT_CHAIN_BROKEN')).toBe(
        'The audit chain is broken, so ask-why is paused (AUDIT_CHAIN_BROKEN).');
    }
    expect(askWhyErrorMessage(500)).toBe('Could not answer. Try again.');
    expect(askWhyErrorMessage(503, true)).toBe('Voice is unavailable. Type your question below.');
    expect(askWhyErrorMessage(409, false, 'OTHER')).toBe('Could not answer. Try again.');
  });

  it('reports broken and recovered chains, hides the lobby text panel, and nests headings', () => {
    const onChainChange = vi.fn();
    for (const valid of [false, true]) {
      const snapshot: AuditSnapshot = {
        entries: [], measuredAt: '2026-10-24T12:00:00Z',
        chain: valid ? { valid: true, length: 0, headHash: '', firstBrokenSeq: null }
          : { valid: false, length: 0, headHash: '', firstBrokenSeq: 1, reason: 'HASH_MISMATCH' },
      };
      const render = (props: NonNullable<Parameters<typeof AuditWall>[0]>) => {
        vi.mocked(React.useState).mockImplementationOnce(() => [snapshot, vi.fn()]);
        // Static rendering does not run effects; run only the chain notification effect.
        vi.mocked(React.useEffect).mockImplementationOnce(() => {}).mockImplementationOnce(effect => { effect(); });
        return renderToStaticMarkup(createElement<NonNullable<Parameters<typeof AuditWall>[0]>>(AuditWall, props));
      };
      const lobby = render({ onChainChange, showAsk: false, headingLevel: 3 });
      expect(onChainChange).toHaveBeenLastCalledWith(valid);
      expect(lobby).toContain('<h3 id="audit-title">Audit wall</h3>');
      expect(lobby).toContain('<h4 id="audit-records-title">Recorded actions</h4>');
      expect(lobby).not.toContain('audit-why');
      expect(lobby).not.toContain('Question about a decision');
      const audit = render({});
      expect(audit).toContain('<h1 id="audit-title">Audit wall</h1>');
      expect(audit).toContain('<h2 id="audit-records-title">Recorded actions</h2>');
      expect(audit).toContain('<h2 id="audit-why-title">Ask why</h2>');
      expect(audit).toContain('Question about a decision');
    }
  });

  it('keeps the AskWhyVoice default label', () => {
    expect(renderToStaticMarkup(createElement(AskWhyVoice))).toContain('aria-label="Ask why"');
  });
});
